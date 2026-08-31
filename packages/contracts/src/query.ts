import { z } from 'zod';
import { isoTimestamp, uuid } from './primitives.js';

const QUESTION_MAX = 2000;

// One retrieved chunk as streamed to the client on the `citations` event. The
// full set of selected chunks is sent, in `[n]` order - `marker` is the handle
// the answer text cites by.
export const Citation = z.object({
  marker: z.number().int().positive(),
  chunkId: uuid,
  bookId: uuid.nullable(),
  bookTitle: z.string(),
  chapterTitle: z.string(),
  chunkText: z.string(),
});
export type Citation = z.infer<typeof Citation>;

// The frozen snapshot persisted to `queries.citations` (jsonb) and returned by
// `QueryDetailDto`: `Citation` minus `bookId` and `marker`, so a history entry
// still renders after a cited book is deleted.
export const PersistedCitation = Citation.omit({ bookId: true, marker: true });
export type PersistedCitation = z.infer<typeof PersistedCitation>;

// `POST /api/v1/queries`. `bookId` optionally restricts retrieval to one book.
export const CreateQueryRequest = z.object({
  question: z.string().min(1).max(QUESTION_MAX),
  bookId: uuid.optional(),
});
export type CreateQueryRequest = z.infer<typeof CreateQueryRequest>;

// `GET /api/v1/queries` - the history list. `answer` body omitted; `bookId` may
// be null (cross-book query, or the filtered book was later deleted).
export const QueryListItemDto = z.object({
  id: uuid,
  question: z.string(),
  bookId: uuid.nullable(),
  createdAt: isoTimestamp,
});
export type QueryListItemDto = z.infer<typeof QueryListItemDto>;

// `GET /api/v1/queries/:id`. `answer` is null if synthesis failed. `citations`
// is the self-contained jsonb snapshot from the row.
export const QueryDetailDto = z.object({
  id: uuid,
  question: z.string(),
  answer: z.string().nullable(),
  bookId: uuid.nullable(),
  citations: z.array(PersistedCitation),
  createdAt: isoTimestamp,
});
export type QueryDetailDto = z.infer<typeof QueryDetailDto>;

// --- Query SSE stream (read on the client with fetch() + a ReadableStream
// reader, not EventSource). The `type` field is the SSE `event:` name. ---

export const QueryStartedEvent = z.object({
  type: z.literal('query_started'),
  id: uuid,
});

export const QueryCitationsEvent = z.object({
  type: z.literal('citations'),
  citations: z.array(Citation),
});

export const QueryTextDeltaEvent = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
});

export const QueryDoneEvent = z.object({
  type: z.literal('done'),
  answer: z.string(),
});

export const QueryErrorEvent = z.object({
  type: z.literal('error'),
  message: z.string(),
});

export const QueryEvent = z.discriminatedUnion('type', [
  QueryStartedEvent,
  QueryCitationsEvent,
  QueryTextDeltaEvent,
  QueryDoneEvent,
  QueryErrorEvent,
]);
export type QueryEvent = z.infer<typeof QueryEvent>;
