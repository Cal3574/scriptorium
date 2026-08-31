import { z } from 'zod';
import { BookStatus } from './book.js';
import { uuid } from './primitives.js';

// --- Queue and job identifiers ---

// The single BullMQ queue that carries both the per-book ingest job and the
// per-book delete job (worker concurrency 1 serialises them).
export const INGEST_QUEUE_NAME = 'ingest';

// Job names on the `ingest` queue.
export const INGEST_JOB_NAME = 'ingest';
export const DELETE_JOB_NAME = 'delete';

// --- Pipeline stages ---

// The six stages the worker walks from the top on every job start. These are
// the internal stage names, distinct from the coarser `book_status` display
// values ('extract' and 'identifyBook' both run under `extracting`; both
// summary stages run under `summarizing`).
export const pipelineStages = [
  'extract',
  'identifyBook',
  'chunk',
  'embed',
  'bookSummary',
  'chapterSummary',
] as const;
export const PipelineStage = z.enum(pipelineStages);
export type PipelineStage = z.infer<typeof PipelineStage>;

// The BullMQ job payload for an ingest job. `requestId` is threaded from
// `POST /books` so one id traces an upload through the API and the pipeline.
export const IngestJobData = z.object({
  bookId: uuid,
  requestId: uuid.optional(),
});
export type IngestJobData = z.infer<typeof IngestJobData>;

// --- SSE progress events (published by the worker over Redis pub/sub, bridged
// to the browser by the API). The `type` field is the SSE `event:` name; every
// payload carries `bookId` and `seq`. ---

// The active-processing subset of `book_status` that the SSE layer reports as
// the "current stage"; null in the snapshot when pending / ready / failed.
export const ProcessingStage = z.enum([
  'extracting',
  'chunking',
  'embedding',
  'summarizing',
]);
export type ProcessingStage = z.infer<typeof ProcessingStage>;

export const ProgressUnit = z.enum(['chunks', 'chapters']);
export type ProgressUnit = z.infer<typeof ProgressUnit>;

const Progress = z.object({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  unit: ProgressUnit,
});

const eventBase = {
  bookId: uuid,
  seq: z.number().int().nonnegative(),
};

// First frame on every connect and reconnect; a full snapshot of DB state.
export const SnapshotEvent = z.object({
  type: z.literal('snapshot'),
  ...eventBase,
  status: BookStatus,
  stage: ProcessingStage.nullable(),
  progress: Progress.nullable(),
  chaptersTotal: z.number().int().nonnegative(),
  chaptersSummarized: z.number().int().nonnegative(),
  title: z.string().nullable(),
  author: z.string().nullable(),
  failedStage: z.string().nullable(),
  failureReason: z.string().nullable(),
});

export const StageEnteredEvent = z.object({
  type: z.literal('stage_entered'),
  ...eventBase,
  stage: ProcessingStage,
  status: BookStatus,
});

// Emitted only for the two long stages (`embed` per batch, `chapterSummary`
// per completed chapter).
export const StageProgressEvent = z.object({
  type: z.literal('stage_progress'),
  ...eventBase,
  stage: ProcessingStage,
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  unit: ProgressUnit,
});

// Title/author backfilled; lets the Library swap the card mid-pipeline.
export const BookIdentifiedEvent = z.object({
  type: z.literal('book_identified'),
  ...eventBase,
  title: z.string().nullable(),
  author: z.string().nullable(),
});

export const BookCompletedEvent = z.object({
  type: z.literal('book_completed'),
  ...eventBase,
  status: z.literal('ready'),
});

export const BookFailedEvent = z.object({
  type: z.literal('book_failed'),
  ...eventBase,
  failedStage: z.string(),
  failureReason: z.string(),
});

export const BookDeletedEvent = z.object({
  type: z.literal('book_deleted'),
  ...eventBase,
});

// The discriminated union over all seven SSE event schemas.
export const IngestEvent = z.discriminatedUnion('type', [
  SnapshotEvent,
  StageEnteredEvent,
  StageProgressEvent,
  BookIdentifiedEvent,
  BookCompletedEvent,
  BookFailedEvent,
  BookDeletedEvent,
]);
export type IngestEvent = z.infer<typeof IngestEvent>;
