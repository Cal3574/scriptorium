import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  DELETE_JOB_NAME,
  INGEST_JOB_NAME,
  INGEST_QUEUE_NAME,
  IngestJobData,
} from '@scriptorium/contracts';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import { runWithRequestContext } from '@scriptorium/server-core';
import { IngestProcessor } from './ingest-processor.js';
import { errorMessage } from './errors.js';

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
 * The BullMQ consumer for the `ingest` queue. Delegates ingest jobs to
 * {@link IngestProcessor}; a delete job is out of scope for this ticket and is
 * logged and skipped (see #28).
 */
@Injectable()
export class IngestWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(IngestWorker.name);
  private worker?: Worker;

  constructor(
    private readonly processor: IngestProcessor,
    private readonly options: IngestWorkerOptions,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      INGEST_QUEUE_NAME,
      (job) => this.handle(job),
      {
        connection: { url: this.options.redisUrl },
        concurrency: CONCURRENCY,
        lockDuration: LOCK_DURATION_MS,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      );
    });
    this.logger.log(
      `listening on "${INGEST_QUEUE_NAME}" (concurrency ${CONCURRENCY})`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  private async handle(job: Job): Promise<unknown> {
    if (job.name === DELETE_JOB_NAME) {
      this.logger.warn(
        `delete job ${job.id} skipped - not implemented in this build (#28)`,
      );
      return { skipped: true };
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
