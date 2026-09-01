import type { BookStatus, PipelineStage } from '@scriptorium/contracts';
import type { LlmClient, ObjectStorage, PdfExtractor } from '@scriptorium/providers';
import type { BookRow, IngestRepository } from '@scriptorium/server-core';
import type { StageEventPublisher } from './stage-event-publisher.js';

// A minimal logger surface so a stage can log without pulling Nest's `Logger`
// into unit tests.
export interface StageLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface StageDeps {
  repo: IngestRepository;
  storage: ObjectStorage;
  pdfExtractor: PdfExtractor;
  llm: LlmClient;
  events: StageEventPublisher;
  logger: StageLogger;
}

/**
 * One step of the fixed ingest pipeline. The processor walks the whole
 * `STAGES` list from the top on every job start; a stage decides for itself
 * whether its work is already done ({@link isComplete}, checked against its
 * own artifact columns, never `book_status`), and only then does {@link run}
 * execute.
 */
export interface Stage {
  name: PipelineStage;
  // `book_status` written on entering this stage. `null` means "leave the
  // status where it is" - `identifyBook` runs under `extracting` and adds no
  // new state.
  enterStatus: BookStatus | null;
  // Derive-from-data resumption: true when this stage's artifact already
  // exists, so a re-run skips straight past it.
  isComplete(book: BookRow, deps: StageDeps): Promise<boolean>;
  run(book: BookRow, deps: StageDeps): Promise<void>;
}
