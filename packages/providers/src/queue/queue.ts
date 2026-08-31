import type { IngestJobData } from '@scriptorium/contracts';

// The seam between the API (which enqueues work) and the worker (which drains
// it). One BullMQ queue carries both the per-book ingest job and the per-book
// delete job; the job id is the book id in both cases so a duplicate enqueue
// for the same book is a no-op. The live adapter wraps a BullMQ `Queue`; the
// fake keeps jobs in memory.

export interface DeleteJobData {
  bookId: string;
}

export interface Queue {
  // Enqueue the ingest pipeline for a book. Idempotent per `bookId`.
  enqueueIngest(data: IngestJobData): Promise<void>;
  // Enqueue a hard delete of a book and everything derived from it.
  enqueueDelete(data: DeleteJobData): Promise<void>;
  // Release the underlying connection. Called on graceful shutdown.
  close(): Promise<void>;
}

// Nest DI token; bound by `server-core`.
export const QUEUE = Symbol('Queue');
