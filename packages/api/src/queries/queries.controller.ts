import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  CreateQueryRequest,
  queryEventFrame,
  QUESTION_MAX,
} from '@scriptorium/contracts';
import {
  assertOwnership,
  type AuthenticatedUser,
  BooksRepository,
  CurrentUser,
} from '@scriptorium/server-core';
import { createZodDto } from 'nestjs-zod';
import { QuestionTooLongException } from './queries.problems.js';
import { QueryService } from './query.service.js';

// The minimal slices of the Express response / request the SSE handler needs,
// declared locally so the controller does not pull in `@types/express`
// (mirrors `books-events.controller.ts`).
interface SseResponse {
  setHeader(name: string, value: string): void;
  flushHeaders(): void;
  write(chunk: string): void;
  end(): void;
}
interface SseRequest {
  on(event: 'close', listener: () => void): void;
}

class CreateQueryDto extends createZodDto(CreateQueryRequest) {}

/**
 * `POST /api/v1/queries` - a reader's natural-language question answered from
 * their own books, streamed over the POST response body as Server-Sent Events
 * (the client reads it with `fetch()` + a `ReadableStream` reader, not
 * `EventSource`).
 *
 * Guards run before the stream opens: an over-length question is `422
 * question_too_long`; a foreign or missing `bookId` is an identical `404`; a
 * question-embedding failure is `502` (raised from the generator's first
 * `next()`). Once headers are flushed, every outcome - including a mid-stream
 * synthesis failure - is an SSE `error` event, never an HTTP status.
 */
@Controller('queries')
export class QueriesController {
  constructor(
    private readonly service: QueryService,
    private readonly books: BooksRepository,
  ) {}

  @Post()
  @HttpCode(200)
  async create(
    @Body() body: CreateQueryDto,
    @CurrentUser() caller: AuthenticatedUser,
    @Req() req: SseRequest,
    @Res() res: SseResponse,
  ): Promise<void> {
    if (body.question.length > QUESTION_MAX) {
      throw new QuestionTooLongException(QUESTION_MAX);
    }

    const bookId = body.bookId ?? null;
    if (bookId) {
      const found = await this.books.findById(bookId);
      assertOwnership(found, caller.id, 'book_not_found');
    }

    // A browser disconnect aborts the signal (stops the paid synthesis) and
    // unwinds the generator without writing `answer`.
    const abort = new AbortController();
    const events = this.service.run(
      { userId: caller.id, question: body.question, bookId },
      abort.signal,
    );

    // Pull the first event before writing any headers, so a pre-stream failure
    // (the `502` question-embedding case) still surfaces as problem+json from
    // the global filter rather than as a half-open stream.
    const first = await events.next();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let disconnected = false;
    req.on('close', () => {
      disconnected = true;
      abort.abort();
      void Promise.resolve(events.return?.(undefined)).catch(() => undefined);
    });

    for (
      let current = first;
      !current.done && !disconnected;
      current = await events.next()
    ) {
      res.write(queryEventFrame(current.value));
    }

    if (!disconnected) res.end();
  }
}
