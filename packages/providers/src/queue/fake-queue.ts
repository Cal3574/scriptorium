import type { DeleteJobData, IngestJobData } from '@scriptorium/contracts';
import type { IngestJobLifecycle, Queue } from './queue.js';

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
 *
 * An ingest job starts life `waiting`; a test can move it to `active` (or any
 * other state) with {@link setIngestJobState} to exercise the delete flow's
 * "wait for the running stage" path.
 */
export class FakeQueue implements Queue {
  private readonly jobs = new Map<string, RecordedJob>();
  private readonly ingestState = new Map<string, IngestJobLifecycle>();

  enqueueIngest(data: IngestJobData): Promise<void> {
    const added = this.record({
      name: 'ingest',
      jobId: ingestJobId(data.bookId),
      data,
    });
    if (added) this.ingestState.set(data.bookId, 'waiting');
    return Promise.resolve();
  }

  reenqueueIngest(data: IngestJobData): Promise<void> {
    // Drop any finished job parked under this jobId so the re-enqueue is not
    // swallowed as a duplicate, then enqueue afresh.
    this.jobs.delete(ingestJobId(data.bookId));
    this.ingestState.delete(data.bookId);
    return this.enqueueIngest(data);
  }

  enqueueDelete(data: DeleteJobData): Promise<void> {
    this.record({ name: 'delete', jobId: deleteJobId(data.bookId), data });
    return Promise.resolve();
  }

  ingestJobStatus(bookId: string): Promise<IngestJobLifecycle> {
    return Promise.resolve(this.ingestState.get(bookId) ?? 'missing');
  }

  removeIngestJob(bookId: string): Promise<boolean> {
    const state = this.ingestState.get(bookId);
    if (state !== 'waiting' && state !== 'delayed') {
      return Promise.resolve(false);
    }
    this.jobs.delete(ingestJobId(bookId));
    this.ingestState.delete(bookId);
    return Promise.resolve(true);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  /** Every job enqueued so far, in insertion order. */
  get recorded(): RecordedJob[] {
    return [...this.jobs.values()];
  }

  /** Test hook: force a book's ingest job into a given lifecycle state. */
  setIngestJobState(bookId: string, state: IngestJobLifecycle): void {
    this.ingestState.set(bookId, state);
  }

  clear(): void {
    this.jobs.clear();
    this.ingestState.clear();
  }

  private record(job: RecordedJob): boolean {
    if (this.jobs.has(job.jobId)) return false;
    this.jobs.set(job.jobId, job);
    return true;
  }
}
