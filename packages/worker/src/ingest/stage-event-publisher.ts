import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  bookEventsChannel,
  bookEventsSeqKey,
  type BookStatus,
  type IngestEvent,
  type ProcessingStage,
  type ProgressUnit,
} from '@scriptorium/contracts';
import { EVENT_TRANSPORT, type EventTransport } from './event-transport.js';

// Every event variant minus the fields the publisher fills in (`bookId`,
// `seq`), distributed over the union so each variant keeps its own shape.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type EventBody = DistributiveOmit<IngestEvent, 'bookId' | 'seq'>;

/**
 * Publishes the SSE progress events for one book. Each event gets a per-book
 * monotonic `seq` from a Redis `INCR` (so a reconnecting client can drop
 * anything it has already applied) and is published to
 * `book:events:{bookId}`. Terminal events are not awaited by callers on the
 * hot path - the database is truth.
 */
@Injectable()
export class StageEventPublisher {
  private readonly logger = new Logger(StageEventPublisher.name);

  constructor(
    @Inject(EVENT_TRANSPORT) private readonly transport: EventTransport,
  ) {}

  // Fire-and-forget: the database is the source of truth and every SSE
  // connection re-fetches a full snapshot on connect, so a lost event only
  // costs a little latency. A transport failure must never fail an ingest
  // job, so it is logged and swallowed here rather than propagated.
  private async emit(bookId: string, body: EventBody): Promise<void> {
    try {
      const seq = await this.transport.incr(bookEventsSeqKey(bookId));
      const event = { ...body, bookId, seq } as IngestEvent;
      await this.transport.publish(
        bookEventsChannel(bookId),
        JSON.stringify(event),
      );
    } catch (error) {
      this.logger.warn(
        `dropped ${body.type} event for book ${bookId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  stageEntered(
    bookId: string,
    stage: ProcessingStage,
    status: BookStatus,
  ): Promise<void> {
    return this.emit(bookId, { type: 'stage_entered', stage, status });
  }

  stageProgress(
    bookId: string,
    stage: ProcessingStage,
    progress: { done: number; total: number; unit: ProgressUnit },
  ): Promise<void> {
    return this.emit(bookId, { type: 'stage_progress', stage, ...progress });
  }

  bookIdentified(
    bookId: string,
    title: string | null,
    author: string | null,
  ): Promise<void> {
    return this.emit(bookId, { type: 'book_identified', title, author });
  }

  bookCompleted(bookId: string): Promise<void> {
    return this.emit(bookId, { type: 'book_completed', status: 'ready' });
  }

  bookFailed(
    bookId: string,
    failedStage: string,
    failureReason: string,
  ): Promise<void> {
    return this.emit(bookId, {
      type: 'book_failed',
      failedStage,
      failureReason,
    });
  }
}
