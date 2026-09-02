import type { IngestEvent } from '@scriptorium/contracts';

/**
 * The read side of the worker's SSE progress channel. The worker publishes
 * per-book stage events to Redis with a per-book monotonic `seq`; this seam
 * lets the API bridge them to a browser `EventSource` without the HTTP layer
 * knowing about Redis, and lets the stream logic be unit-tested with an
 * in-memory fake.
 */
export abstract class IngestEventSubscriber {
  /**
   * The highest `seq` already assigned for this book (0 if the pipeline has
   * not emitted anything yet). The opening snapshot carries this value so a
   * reconnecting client can drop every event it has already applied.
   */
  abstract currentSeq(bookId: string): Promise<number>;

  /**
   * Deliver every future event for `bookId` to `onEvent` until the returned
   * function is called. Malformed payloads are dropped silently - the
   * database snapshot is the source of truth.
   */
  abstract subscribe(
    bookId: string,
    onEvent: (event: IngestEvent) => void,
  ): Promise<() => void>;

  /** Release any underlying connections. Called on application shutdown. */
  abstract close(): Promise<void>;
}

export const INGEST_EVENT_SUBSCRIBER = Symbol('IngestEventSubscriber');
