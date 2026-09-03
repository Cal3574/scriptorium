import { Queue as BullQueue } from 'bullmq';
import {
  DELETE_JOB_NAME,
  type DeleteJobData,
  INGEST_JOB_NAME,
  INGEST_QUEUE_NAME,
  type IngestJobData,
} from '@scriptorium/contracts';
import type { IngestJobLifecycle, Queue } from './queue.js';

// Job-level retry and retention policy, verbatim from the ingest-job spec:
// one initial run plus three retries with exponential backoff from 10s; keep a
// day of completed-job history capped at 100; keep failed jobs indefinitely as
// the audit trail.
const JOB_OPTIONS = {
  attempts: 4,
  backoff: { type: 'exponential' as const, delay: 10_000 },
  removeOnComplete: { age: 86_400, count: 100 },
  removeOnFail: false,
} as const;

// The delete job shares the one `ingest` queue with the ingest job, so it needs
// a distinct `jobId` namespace - otherwise BullMQ would treat a delete for a
// book that still has an ingest job queued as a duplicate and drop it.
const deleteJobId = (bookId: string): string => `delete:${bookId}`;

export interface BullMqQueueOptions {
  redisUrl: string;
}

/**
 * Live {@link Queue} backed by a BullMQ queue on Redis. Both job types share
 * one queue (worker concurrency 1 serialises them) and use the book id as the
 * BullMQ `jobId`, so a duplicate enqueue for a book is dropped by BullMQ.
 */
export class BullMqQueue implements Queue {
  private readonly queue: BullQueue;

  constructor(options: BullMqQueueOptions) {
    this.queue = new BullQueue(INGEST_QUEUE_NAME, {
      connection: { url: options.redisUrl },
      defaultJobOptions: JOB_OPTIONS,
    });
  }

  async enqueueIngest(data: IngestJobData): Promise<void> {
    await this.queue.add(INGEST_JOB_NAME, data, { jobId: data.bookId });
  }

  async reenqueueIngest(data: IngestJobData): Promise<void> {
    const existing = await this.queue.getJob(data.bookId);
    if (existing) {
      try {
        await existing.remove();
      } catch {
        // A locked (active) job cannot be removed; the `add` below is then the
        // no-op duplicate, which is fine - the job already running IS the retry.
      }
    }
    await this.queue.add(INGEST_JOB_NAME, data, { jobId: data.bookId });
  }

  async enqueueDelete(data: DeleteJobData): Promise<void> {
    await this.queue.add(DELETE_JOB_NAME, data, {
      jobId: deleteJobId(data.bookId),
    });
  }

  async ingestJobStatus(bookId: string): Promise<IngestJobLifecycle> {
    const job = await this.queue.getJob(bookId);
    if (!job) return 'missing';
    const state = await job.getState();
    switch (state) {
      case 'waiting':
      case 'waiting-children':
      case 'prioritized':
        return 'waiting';
      case 'delayed':
        return 'delayed';
      case 'active':
        return 'active';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'missing';
    }
  }

  async removeIngestJob(bookId: string): Promise<boolean> {
    const job = await this.queue.getJob(bookId);
    if (!job) return false;
    try {
      // BullMQ refuses to remove a locked (active) job; treat that as "not
      // removable" and let the caller wait it out instead.
      await job.remove();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
