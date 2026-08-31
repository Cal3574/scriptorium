import type { IngestJobData } from '@scriptorium/contracts';
import type { DeleteJobData, Queue } from './queue.js';

export interface RecordedJob {
  name: 'ingest' | 'delete';
  // The BullMQ `jobId` this enqueue would use: the book id for an ingest job,
  // `delete:<bookId>` for a delete job.
  jobId: string;
  data: IngestJobData | DeleteJobData;
}

// Mirror `BullMqQueue`'s jobId scheme exactly so the fake's de-dupe behaviour
// matches the real one.
const ingestJobId = (bookId: string): string => bookId;
const deleteJobId = (bookId: string): string => `delete:${bookId}`;

/**
 * In-memory {@link Queue}. Records every enqueue keyed by the same `jobId`
 * BullMQ would use, and - like BullMQ - drops a second enqueue for a `jobId`
 * that is already present. Exposes the recorded jobs for assertions and for a
 * test harness that wants to drive the pipeline directly.
 */
export class FakeQueue implements Queue {
  private readonly jobs = new Map<string, RecordedJob>();

  enqueueIngest(data: IngestJobData): Promise<void> {
    this.record({ name: 'ingest', jobId: ingestJobId(data.bookId), data });
    return Promise.resolve();
  }

  enqueueDelete(data: DeleteJobData): Promise<void> {
    this.record({ name: 'delete', jobId: deleteJobId(data.bookId), data });
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  /** Every job enqueued so far, in insertion order. */
  get recorded(): RecordedJob[] {
    return [...this.jobs.values()];
  }

  clear(): void {
    this.jobs.clear();
  }

  private record(job: RecordedJob): void {
    if (!this.jobs.has(job.jobId)) this.jobs.set(job.jobId, job);
  }
}
