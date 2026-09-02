import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  BookStatus,
  PipelineStage,
  ProcessingStage,
} from '@scriptorium/contracts';
import {
  LLM_CLIENT,
  OBJECT_STORAGE,
  PDF_EXTRACTOR,
  type LlmClient,
  type ObjectStorage,
  type PdfExtractor,
} from '@scriptorium/providers';
import { IngestRepository } from '@scriptorium/server-core';
import { UnrecoverableError } from 'bullmq';
import { errorMessage, isRetryable } from './errors.js';
import { STAGES } from './stages.js';
import type { Stage, StageDeps } from './stage.js';
import { StageEventPublisher } from './stage-event-publisher.js';

export type IngestOutcome =
  | { status: 'completed'; lastStage: PipelineStage | null }
  | { status: 'aborted' }
  | { status: 'gone' }
  | { status: 'failed'; stage: PipelineStage };

export interface ProcessOptions {
  // True on the last job-level attempt: a retryable stage failure is then
  // promoted to a terminal one so the book lands `failed` rather than silently
  // stalling in an in-progress status.
  finalAttempt?: boolean;
}

const PROCESSING_STATUSES = new Set<BookStatus>([
  'extracting',
  'chunking',
  'embedding',
  'summarizing',
]);

function toProcessingStage(status: BookStatus): ProcessingStage | null {
  return PROCESSING_STATUSES.has(status) ? (status as ProcessingStage) : null;
}

/**
 * The checkpointed sequential pipeline. On every job start it walks the fixed
 * {@link STAGES} list from the top:
 *
 *  - an abort check at each stage boundary returns cleanly if the book is
 *    being deleted;
 *  - a stage whose artifact already exists (`isComplete`) is skipped -
 *    resumption is derived from data, never from `book_status`;
 *  - entering a stage writes its `book_status` and publishes a `stage_entered`
 *    event;
 *  - a terminal stage error marks the book `failed` and throws
 *    `UnrecoverableError`; a retryable one propagates for the job-level retry
 *    (and, on the final attempt, is itself promoted to `failed`).
 */
@Injectable()
export class IngestProcessor {
  private readonly logger = new Logger(IngestProcessor.name);
  private readonly deps: StageDeps;

  // The fixed pipeline. Overridable in tests to drive a single stage in
  // isolation; production always walks the full list.
  stages: readonly Stage[] = STAGES;

  constructor(
    private readonly repo: IngestRepository,
    private readonly events: StageEventPublisher,
    @Inject(OBJECT_STORAGE) storage: ObjectStorage,
    @Inject(PDF_EXTRACTOR) pdfExtractor: PdfExtractor,
    @Inject(LLM_CLIENT) llm: LlmClient,
  ) {
    this.deps = {
      repo,
      storage,
      pdfExtractor,
      llm,
      events,
      logger: {
        log: (m) => this.logger.log(m),
        warn: (m) => this.logger.warn(m),
        error: (m) => this.logger.error(m),
      },
    };
  }

  async process(
    bookId: string,
    options: ProcessOptions = {},
  ): Promise<IngestOutcome> {
    let lastStage: PipelineStage | null = null;

    for (const stage of this.stages) {
      const book = await this.repo.findById(bookId);
      if (!book) return { status: 'gone' };
      if (book.status === 'deleting') return { status: 'aborted' };

      if (await stage.isComplete(book, this.deps)) {
        lastStage = stage.name;
        continue;
      }

      // "Entering" a stage means the status actually changes. On a resumed
      // attempt the book is already in this status, so neither the write nor
      // the SSE event fires again (a reconnecting client gets the truth from
      // the snapshot frame).
      if (stage.enterStatus && stage.enterStatus !== book.status) {
        await this.repo.setStatus(bookId, stage.enterStatus);
        const processingStage = toProcessingStage(stage.enterStatus);
        if (processingStage) {
          await this.events.stageEntered(
            bookId,
            processingStage,
            stage.enterStatus,
          );
        }
      }

      try {
        await stage.run(book, this.deps);
      } catch (error) {
        const terminal = !isRetryable(error);
        if (terminal || options.finalAttempt) {
          const reason = terminal
            ? errorMessage(error)
            : `retries exhausted in ${stage.name}: ${errorMessage(error)}`;
          await this.repo.markFailed(bookId, {
            failedStage: stage.name,
            failureReason: reason,
          });
          await this.events.bookFailed(bookId, stage.name, reason);
          if (terminal) throw new UnrecoverableError(reason);
        }
        throw error;
      }

      lastStage = stage.name;
    }

    return { status: 'completed', lastStage };
  }
}
