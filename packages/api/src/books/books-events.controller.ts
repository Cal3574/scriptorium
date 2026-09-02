import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import {
  IngestEventStream,
  ProblemException,
  Public,
  sseFrame,
  type SseSink,
  TokenVerifier,
  UsersRepository,
} from '@scriptorium/server-core';
import { SSE_HEARTBEAT_MS } from './books.tokens';

// The minimal slices of the Express response / request the SSE handler needs,
// declared locally so the controller does not pull in `@types/express` (the
// codebase keeps that dependency out of the app packages).
interface SseResponse {
  setHeader(name: string, value: string): void;
  flushHeaders(): void;
  write(chunk: string): void;
  end(): void;
}
interface SseRequest {
  on(event: 'close', listener: () => void): void;
}

class UnauthorizedStreamException extends ProblemException {
  constructor(detail: string) {
    super('unauthorized', 401, 'Unauthorized', detail);
  }
}

/**
 * `GET /api/v1/books/:id/events` - the live ingest-progress stream.
 *
 * Public to the auth guard (an `EventSource` cannot send an `Authorization`
 * header), so the caller's Clerk token rides in `?token=` and is verified here
 * once at connect. Ownership is then checked exactly like every other book
 * route: an unknown id and someone else's id both leave as an identical `404`,
 * before any stream bytes are written.
 */
@Controller('books')
export class BookEventsController {
  constructor(
    private readonly tokenVerifier: TokenVerifier,
    private readonly users: UsersRepository,
    private readonly stream: IngestEventStream,
    @Inject(SSE_HEARTBEAT_MS) private readonly heartbeatMs: number,
  ) {}

  @Public()
  @Get(':id/events')
  async events(
    @Param('id') bookId: string,
    @Query('token') token: string | undefined,
    @Req() req: SseRequest,
    @Res() res: SseResponse,
  ): Promise<void> {
    const userId = await this.authenticate(token);

    // Runs before a single byte is sent, so a 401/404 is still a clean
    // problem+json response from the global filter. It also opens the Redis
    // subscription up front so no event is lost between here and the snapshot.
    const session = await this.stream.open(bookId, userId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Defeat proxy buffering (nginx) so events arrive as they are written.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sink: SseSink = {
      write: (chunk) => res.write(chunk),
      close: () => res.end(),
      onClose: (cb) => req.on('close', cb),
    };

    sink.write(sseFrame(session.snapshot));
    await session.run(sink, { heartbeatMs: this.heartbeatMs });
  }

  private async authenticate(token: string | undefined): Promise<string> {
    if (!token) {
      throw new UnauthorizedStreamException('A ?token= query parameter is required.');
    }
    let verified;
    try {
      verified = await this.tokenVerifier.verify(token);
    } catch {
      throw new UnauthorizedStreamException('The token is invalid or expired.');
    }
    const user = await this.users.upsertFromClerk({
      clerkUserId: verified.sub,
      email: verified.email,
    });
    return user.id;
  }
}
