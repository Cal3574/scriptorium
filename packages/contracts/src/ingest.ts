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
  'chapterSummary',
  'bookSummary',
] as const;
export const PipelineStage = z.enum(pipelineStages);
export type PipelineStage = z.infer<typeof PipelineStage>;

// --- Redis pub/sub keys for SSE progress ---

// The pub/sub channel the worker publishes stage events to and the API's
// `GET /books/:id/events` endpoint subscribes to.
export const bookEventsChannel = (bookId: string): string =>
  `book:events:${bookId}`;

// The Redis key whose `INCR` gives each event a per-book monotonic `seq`, so a
// reconnecting client can drop anything it has already seen.
export const bookEventsSeqKey = (bookId: string): string =>
  `book:events:${bookId}:seq`;

// The BullMQ job payload for an ingest job. `requestId` is threaded from
// `POST /books` so one id traces an upload through the API and the pipeline.
export const IngestJobData = z.object({
  bookId: uuid,
  requestId: uuid.optional(),
});
export type IngestJobData = z.infer<typeof IngestJobData>;

// The BullMQ job payload for a delete job. Shares the `ingest` queue with the
// ingest job (worker concurrency 1 serialises them); `requestId` is threaded
// from `DELETE /books/:id` so one id traces the hard delete end to end.
export const DeleteJobData = z.object({
  bookId: uuid,
  requestId: uuid.optional(),
});
export type DeleteJobData = z.infer<typeof DeleteJobData>;

// The keep-alive cadence for `GET /books/:id/events`, in milliseconds. The
// spec fixes this at 15 seconds; the API config exposes it as an override so
// tests need not wait that long. Defined here so the one value is shared by
// the config loader and the stream implementation.
export const DEFAULT_SSE_HEARTBEAT_MS = 15_000;

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

export type SnapshotEvent = z.infer<typeof SnapshotEvent>;

export const StageEnteredEvent = z.object({
  type: z.literal('stage_entered'),
  ...eventBase,
  stage: ProcessingStage,
  status: BookStatus,
});
export type StageEnteredEvent = z.infer<typeof StageEnteredEvent>;

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
export type StageProgressEvent = z.infer<typeof StageProgressEvent>;

// Title/author backfilled; lets the Library swap the card mid-pipeline.
export const BookIdentifiedEvent = z.object({
  type: z.literal('book_identified'),
  ...eventBase,
  title: z.string().nullable(),
  author: z.string().nullable(),
});
export type BookIdentifiedEvent = z.infer<typeof BookIdentifiedEvent>;

export const BookCompletedEvent = z.object({
  type: z.literal('book_completed'),
  ...eventBase,
  status: z.literal('ready'),
});
export type BookCompletedEvent = z.infer<typeof BookCompletedEvent>;

export const BookFailedEvent = z.object({
  type: z.literal('book_failed'),
  ...eventBase,
  failedStage: z.string(),
  failureReason: z.string(),
});
export type BookFailedEvent = z.infer<typeof BookFailedEvent>;

// Synthesised by the API (never the worker) when a keep-alive poll finds the
// row gone; it closes the stream.
export const BookDeletedEvent = z.object({
  type: z.literal('book_deleted'),
  ...eventBase,
});
export type BookDeletedEvent = z.infer<typeof BookDeletedEvent>;

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
