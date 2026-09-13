import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  AGENT_MESSAGE_MAX,
  agentEventFrame,
  type AgentThreadDto,
  CreateAgentMessageRequest,
  HIGHLIGHTED_PASSAGE_MAX,
} from '@scriptorium/contracts';
import {
  AgentRepository,
  assertOwnership,
  type AuthenticatedUser,
  BooksRepository,
  CurrentUser,
  EntitlementGuard,
  type PostSseRequest,
  type PostSseResponse,
  pumpPostSseStream,
  Quota,
} from '@scriptorium/server-core';
import { createZodDto } from 'nestjs-zod';
import { toAgentThreadDto } from './agent.mapper.js';
import {
  AgentMessageTooLongException,
  HighlightedPassageTooLongException,
} from './agent.problems.js';
import { AgentService } from './agent.service.js';

class CreateAgentMessageDto extends createZodDto(CreateAgentMessageRequest) {}

/**
 * The reading companion, scoped to one book. The thread is addressed by the
 * book rather than by a thread id - there is exactly one per (reader, book) and
 * it is created on first send - so the client never has to hold a thread id to
 * start talking.
 *
 * `POST .../agent-messages` streams the reply over the POST response body as
 * Server-Sent Events on the `AgentEvent` contract, which is parallel to and
 * separate from the legacy `QueryEvent` contract that Ask library uses.
 * Guards run before the stream opens: an unowned or unknown book is `404`, an
 * over-length message or passage is `422`. Once headers are flushed, every
 * outcome - a mid-stream generation failure included - is an `agent_error`
 * event, never an HTTP status.
 */
@Controller('books/:bookId')
@UseGuards(EntitlementGuard)
export class AgentController {
  constructor(
    private readonly service: AgentService,
    private readonly books: BooksRepository,
    private readonly agent: AgentRepository,
  ) {}

  /**
   * The book's conversation so far, oldest message first. A read never creates
   * a thread - only a send does - so an untouched book comes back as an empty
   * conversation (`id: null`, `messages: []`) rather than a `404`, and the
   * client opening the Agent tab on every book leaves no rows behind.
   */
  @Get('agent-thread')
  async thread(
    @Param('bookId') bookId: string,
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<AgentThreadDto> {
    const book = await this.books.findById(bookId);
    assertOwnership(book, caller.id, 'book_not_found');

    const thread = await this.agent.findThreadByUserAndBook(caller.id, bookId);
    if (!thread) {
      return { id: null, bookId, createdAt: null, messages: [] };
    }
    return toAgentThreadDto(thread, await this.agent.listMessages(thread.id));
  }

  /**
   * `@Quota('queries')` runs in `EntitlementGuard` before this handler: an
   * Agent turn spends the same pooled monthly allowance as an Ask library
   * question, so a reader at their ceiling gets `402 query_limit_reached`
   * before any stream headers are flushed and no `agent_messages` row is
   * written.
   */
  @Post('agent-messages')
  @Quota('queries')
  @HttpCode(200)
  async send(
    @Param('bookId') bookId: string,
    @Body() body: CreateAgentMessageDto,
    @CurrentUser() caller: AuthenticatedUser,
    @Req() req: PostSseRequest,
    @Res() res: PostSseResponse,
  ): Promise<void> {
    if (body.message.length > AGENT_MESSAGE_MAX) {
      throw new AgentMessageTooLongException(AGENT_MESSAGE_MAX);
    }
    if ((body.highlightedPassage?.length ?? 0) > HIGHLIGHTED_PASSAGE_MAX) {
      throw new HighlightedPassageTooLongException(HIGHLIGHTED_PASSAGE_MAX);
    }

    const book = await this.books.findById(bookId);
    assertOwnership(book, caller.id, 'book_not_found');

    // A browser disconnect aborts the signal (stops the paid generation) and
    // unwinds the generator without writing the assistant row.
    const abort = new AbortController();
    const events = this.service.run(
      {
        userId: caller.id,
        bookId,
        message: body.message,
        highlightedPassage: body.highlightedPassage ?? null,
      },
      abort.signal,
    );

    // Pull the first event before writing any headers, so a failure that
    // happens before the turn is durable (thread create, the user-message
    // insert) still surfaces as problem+json from the global filter rather
    // than as a half-open stream.
    const first = await events.next();

    await pumpPostSseStream(req, res, first, events, abort, agentEventFrame);
  }
}
