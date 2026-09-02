import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OBJECT_STORAGE,
  QUEUE,
  type ObjectStorage,
  type Queue,
} from '@scriptorium/server-core';
import { IngestRepository } from '@scriptorium/server-core';

export type DeleteOutcome =
  | { status: 'deleted' }
  // The row was already gone - a replayed delete job, or a race with another
  // worker. Nothing left to do.
  | { status: 'gone' };

export interface DeleteProcessorOptions {
  // How long to wait for an `active` ingest job to reach its next stage
  // boundary before giving up and deleting anyway (the pipeline's own abort
  // check still makes the leftover run a no-op). The spec fixes this at 10
  // minutes; tests pass a tiny value.
  activeJobTimeoutMs?: number;
  // Gap between polls while waiting out an `active` ingest job.
  activeJobPollMs?: number;
}

const DEFAULT_ACTIVE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_ACTIVE_POLL_MS = 2_000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The `delete` job's handler. Hard-deletes a book and everything derived from
 * it, even mid-ingest:
 *
 *  1. Stop the ingest job - pull a `waiting`/`delayed` one straight off the
 *     queue, or wait (≤ 10 min) for an `active` one to hit its next stage
 *     boundary, where the pipeline's own `status === 'deleting'` check returns
 *     cleanly.
 *  2. Delete both S3 objects (`s3Key`, `extractedMarkdownKey`).
 *  3. Delete the `books` row - Postgres cascades `chapters`/`chunks` and nulls
 *     `queries.book_id`, so a cited book leaves history intact.
 *
 * Idempotent throughout: a missing row, absent S3 objects, and an
 * already-drained queue are all no-ops.
 */
@Injectable()
export class DeleteProcessor {
  private readonly logger = new Logger(DeleteProcessor.name);
  private readonly activeJobTimeoutMs: number;
  private readonly activeJobPollMs: number;

  constructor(
    private readonly repo: IngestRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(QUEUE) private readonly queue: Queue,
    options: DeleteProcessorOptions = {},
  ) {
    this.activeJobTimeoutMs =
      options.activeJobTimeoutMs ?? DEFAULT_ACTIVE_TIMEOUT_MS;
    this.activeJobPollMs = options.activeJobPollMs ?? DEFAULT_ACTIVE_POLL_MS;
  }

  async process(bookId: string): Promise<DeleteOutcome> {
    const book = await this.repo.findById(bookId);
    if (!book) {
      this.logger.log(`book ${bookId}: already gone, delete job is a no-op`);
      return { status: 'gone' };
    }

    await this.stopIngestJob(bookId);

    await this.storage.deleteObject(book.s3Key);
    if (book.extractedMarkdownKey) {
      await this.storage.deleteObject(book.extractedMarkdownKey);
    }

    await this.repo.deleteBook(bookId);
    this.logger.log(`book ${bookId}: hard-deleted`);
    return { status: 'deleted' };
  }

  private async stopIngestJob(bookId: string): Promise<void> {
    const deadline = Date.now() + this.activeJobTimeoutMs;

    for (;;) {
      const state = await this.queue.ingestJobStatus(bookId);

      if (state === 'waiting' || state === 'delayed') {
        if (await this.queue.removeIngestJob(bookId)) {
          this.logger.log(`book ${bookId}: removed queued ingest job`);
          return;
        }
        // The job slipped out of a removable state (it just started running, or
        // a transient queue error) - fall through and wait it out instead.
      } else if (state !== 'active') {
        return;
      }

      if (Date.now() >= deadline) {
        this.logger.warn(
          `book ${bookId}: ingest job still active after ` +
            `${this.activeJobTimeoutMs}ms - deleting anyway`,
        );
        return;
      }

      await delay(this.activeJobPollMs);
    }
  }
}
