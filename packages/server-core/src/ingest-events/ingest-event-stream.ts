import { Inject, Injectable } from '@nestjs/common';
import {
  BookDeletedEvent,
  DEFAULT_SSE_HEARTBEAT_MS,
  type IngestEvent,
  type SnapshotEvent,
} from '@scriptorium/contracts';
import { BooksRepository } from '../books/books.repository.js';
import { assertOwnership } from '../http/ownership.js';
import {
  INGEST_EVENT_SUBSCRIBER,
  IngestEventSubscriber,
} from './ingest-event-subscriber.js';
import { buildIngestSnapshot } from './ingest-snapshot.js';
import { sseFrame, SSE_KEEPALIVE, type SseSink } from './sse.js';

// The events after which the worker has nothing more to say about a book; the
// stream emits them and then closes.
const TERMINAL_TYPES: ReadonlySet<IngestEvent['type']> = new Set([
  'book_completed',
  'book_failed',
  'book_deleted',
]);

export interface RunOptions {
  heartbeatMs?: number;
}

/**
 * Bridges the worker's Redis progress channel to one browser `EventSource`.
 *
 * {@link open} does everything that must happen before a byte is written: the
 * ownership check (so an unknown or unowned book still leaves as a clean
 * `404`), then - crucially in this order - it subscribes to Redis and only
 * then reads the current `seq` and builds the snapshot. Anything published in
 * the gap is buffered and replayed by {@link IngestStreamSession.run}, so a
 * connect never loses an event.
 */
@Injectable()
export class IngestEventStream {
  constructor(
    private readonly books: BooksRepository,
    @Inject(INGEST_EVENT_SUBSCRIBER)
    private readonly subscriber: IngestEventSubscriber,
  ) {}

  async open(bookId: string, userId: string): Promise<IngestStreamSession> {
    const found = await this.books.findById(bookId);
    const book = assertOwnership(found, userId, 'book_not_found');

    const buffer: IngestEvent[] = [];
    let live: ((event: IngestEvent) => void) | null = null;
    const unsubscribe = await this.subscriber.subscribe(bookId, (event) => {
      if (live) live(event);
      else buffer.push(event);
    });

    try {
      const [counts, seq] = await Promise.all([
        this.books.countChapters(bookId),
        this.subscriber.currentSeq(bookId),
      ]);
      const snapshot = buildIngestSnapshot({
        book,
        chaptersTotal: counts.total,
        chaptersSummarized: counts.summarized,
        seq,
      });
      return new IngestStreamSession(
        this.books,
        bookId,
        snapshot,
        buffer,
        unsubscribe,
        (handler) => {
          live = handler;
        },
      );
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }
}

/**
 * One live connection. The caller writes the snapshot frame, then hands the
 * sink to {@link run}, which replays anything buffered since {@link
 * IngestEventStream.open} subscribed, streams live deltas (dropping any `seq`
 * at or below the snapshot's), keeps the socket warm, polls for a hard-delete,
 * and tears the subscription down on the first terminal event or on
 * disconnect.
 */
export class IngestStreamSession {
  constructor(
    private readonly books: BooksRepository,
    private readonly bookId: string,
    readonly snapshot: SnapshotEvent,
    private readonly buffer: IngestEvent[],
    private readonly unsubscribe: () => void,
    private readonly goLive: (handler: (event: IngestEvent) => void) => void,
  ) {}

  /** Abandon the connection before {@link run} - releases the subscription. */
  close(): void {
    this.unsubscribe();
  }

  async run(sink: SseSink, options: RunOptions = {}): Promise<void> {
    const heartbeatMs = options.heartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS;
    let lastSeq = this.snapshot.seq;
    let done = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let heartbeatBusy = false;

    return new Promise<void>((resolve) => {
      const finish = () => {
        if (done) return;
        done = true;
        if (timer) clearInterval(timer);
        this.unsubscribe();
        resolve();
      };

      const deliver = (event: IngestEvent) => {
        if (done || event.seq <= lastSeq) return;
        lastSeq = event.seq;
        sink.write(sseFrame(event));
        if (TERMINAL_TYPES.has(event.type)) {
          finish();
          sink.close();
        }
      };

      // Replay the connect-gap, then attach for live delivery.
      for (const event of this.buffer.splice(0)) deliver(event);
      if (done) return;
      this.goLive(deliver);

      const heartbeat = async () => {
        if (done || heartbeatBusy) return;
        heartbeatBusy = true;
        try {
          sink.write(SSE_KEEPALIVE);
          const book = await this.books.findById(this.bookId);
          if (!book && !done) {
            sink.write(
              sseFrame(
                BookDeletedEvent.parse({
                  type: 'book_deleted',
                  bookId: this.bookId,
                  seq: lastSeq + 1,
                }),
              ),
            );
            finish();
            sink.close();
          }
        } finally {
          heartbeatBusy = false;
        }
      };

      timer = setInterval(() => void heartbeat(), heartbeatMs);
      sink.onClose(finish);
    });
  }
}
