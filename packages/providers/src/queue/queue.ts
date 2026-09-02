import type { DeleteJobData, IngestJobData } from '@scriptorium/contracts';

// The seam between the API (which enqueues work) and the worker (which drains
// it). One BullMQ queue carries both the per-book ingest job and the per-book
// delete job; the job id is the book id in both cases so a duplicate enqueue
// for the same book is a no-op. The live adapter wraps a BullMQ `Queue`; the
// fake keeps jobs in memory.

// The lifecycle of a book's ingest job as the delete flow cares about it.
// `waiting`/`delayed` jobs can be pulled straight off the queue; an `active`
// one has to be waited out; anything else means there is nothing to stop.
export type IngestJobLifecycle =
  'waiting' | 'delayed' | 'active' | 'completed' | 'failed' | 'missing';

export interface Queue {
  // Enqueue the ingest pipeline for a book. Idempotent per `bookId`.
  enqueueIngest(data: IngestJobData): Promise<void>;
  // Enqueue a hard delete of a book and everything derived from it.
  enqueueDelete(data: DeleteJobData): Promise<void>;
  // The current lifecycle state of a book's ingest job.
  ingestJobStatus(bookId: string): Promise<IngestJobLifecycle>;
  // Pull a not-yet-started (`waiting`/`delayed`) ingest job off the queue.
  // Resolves `true` when a job was removed, `false` when there was nothing
  // removable (already running, finished, or never enqueued).
  removeIngestJob(bookId: string): Promise<boolean>;
  // Release the underlying connection. Called on graceful shutdown.
  close(): Promise<void>;
}

// Nest DI token; bound by `server-core`.
export const QUEUE = Symbol('Queue');
