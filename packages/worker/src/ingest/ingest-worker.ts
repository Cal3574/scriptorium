import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  DELETE_JOB_NAME,
  DeleteJobData,
  INGEST_JOB_NAME,
  INGEST_QUEUE_NAME,
  IngestJobData,
} from '@scriptorium/contracts';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import {
  IngestRepository,
  runWithRequestContext,
} from '@scriptorium/server-core';
import { IngestProcessor } from './ingest-processor.js';
import { DeleteProcessor } from './delete-processor.js';
import { errorMessage } from './errors.js';
import { StageEventPublisher } from './stage-event-publisher.js';

const TERMINAL_BOOK_STATUSES = new Set(['failed', 'ready', 'deleting']);

// Verbatim from the ingest-job spec. `lockDuration` is renewed automatically
// by BullMQ while a stage runs; concurrency 1 keeps the single-replica worker
// strictly sequential so an ingest and a delete for the same book never
// interleave.
const LOCK_DURATION_MS = 60_000;
const CONCURRENCY = 1;

export interface IngestWorkerOptions {
  redisUrl: string;
  // Total job-level attempts, mirrored from the queue's `defaultJobOptions` so
  // the processor knows when it is on the last attempt.
  attempts: number;
}

/**
 * The BullMQ consumer for the `ingest` queue. Delegates an ingest job to
 * {@link IngestProcessor} and a delete job to {@link DeleteProcessor}; worker
 * concurrency 1 keeps the two serialised for any one book.
 */
@Injectable()
export class IngestWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(IngestWorker.name);
  private worker?: Worker;

  constructor(
    private readonly processor: IngestProcessor,
    private readonly deleteProcessor: DeleteProcessor,
    private readonly repo: IngestRepository,
    private readonly events: StageEventPublisher,
    private readonly options: IngestWorkerOptions,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(INGEST_QUEUE_NAME, (job) => this.handle(job), {
      connection: { url: this.options.redisUrl },
      concurrency: CONCURRENCY,
      lockDuration: LOCK_DURATION_MS,
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      );
      this.recoverStrandedBook(job, err).catch((recoverErr) => {
        this.logger.error(
          `job ${job?.id}: failed to recover stranded book after queue-level failure: ${errorMessage(recoverErr)}`,
        );
      });
    });
    this.logger.log(
      `listening on "${INGEST_QUEUE_NAME}" (concurrency ${CONCURRENCY})`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  // A job BullMQ gives up on outside our own error handling - most notably
  // "stalled more than allowable limit", raised when the process holding the
  // lock dies (a worker restart, an OOM kill) - never runs `IngestProcessor`'s
  // catch block, so the book row is left parked in whatever in-progress
  // status it was last set to, with no route back to `failed` for `/retry` to
  // pick up. `job.isFailed()` re-reads the queue's own state to tell that
  // case apart from an ordinary attempt BullMQ is about to retry, for which
  // this must do nothing.
  private async recoverStrandedBook(
    job: Job | undefined,
    err: Error,
  ): Promise<void> {
    if (!job || job.name !== INGEST_JOB_NAME) return;
    if (!(await job.isFailed())) return;

    const data = IngestJobData.parse(job.data);
    const book = await this.repo.findById(data.bookId);
    if (!book || TERMINAL_BOOK_STATUSES.has(book.status)) return;

    const failedStage = book.status;
    const failureReason = `queue gave up on the job: ${err.message}`;
    await this.repo.markFailed(data.bookId, { failedStage, failureReason });
    await this.events.bookFailed(data.bookId, failedStage, failureReason);
    this.logger.warn(
      `book ${data.bookId}: marked failed after a queue-level (non-processor) failure - ${err.message}`,
    );
  }

  private async handle(job: Job): Promise<unknown> {
    if (job.name === DELETE_JOB_NAME) {
      const data = DeleteJobData.parse(job.data);
      const run = () => this.deleteProcessor.process(data.bookId);
      return data.requestId
        ? runWithRequestContext({ requestId: data.requestId }, run)
        : run();
    }
    if (job.name !== INGEST_JOB_NAME) {
      throw new UnrecoverableError(`unknown job name "${job.name}"`);
    }

    const data = IngestJobData.parse(job.data);
    const finalAttempt = job.attemptsMade + 1 >= this.options.attempts;

    const run = () =>
      this.processor.process(data.bookId, { finalAttempt }).then((outcome) => {
        this.logger.log(
          `book ${data.bookId}: ${outcome.status}${
            'lastStage' in outcome && outcome.lastStage
              ? ` (through ${outcome.lastStage})`
              : ''
          }`,
        );
        return outcome;
      });

    try {
      return data.requestId
        ? await runWithRequestContext({ requestId: data.requestId }, run)
        : await run();
    } catch (error) {
      this.logger.error(
        `book ${data.bookId} ingest error: ${errorMessage(error)}`,
      );
      throw error;
    }
  }
}
