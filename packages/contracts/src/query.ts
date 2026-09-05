import { z } from 'zod';
import { isoTimestamp, uuid } from './primitives.js';

// The endpoint enforces the upper bound itself so it can return the specific
// `question_too_long` problem (a schema `.max()` would collapse it into the
// generic `validation_failed`).
export const QUESTION_MAX = 2000;

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
  question: z.string().min(1),
  bookId: uuid.optional(),
});
export type CreateQueryRequest = z.infer<typeof CreateQueryRequest>;

// `GET /api/v1/queries` - the history list. `answer` body omitted; `bookId` may
// be null (cross-book query, or the filtered book was later deleted). `failed`
// is derived from `answer IS NULL` server-side, so a failed row is visible
// without a second round trip to `GET /queries/:id`.
export const QueryListItemDto = z.object({
  id: uuid,
  question: z.string(),
  bookId: uuid.nullable(),
  failed: z.boolean(),
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

// One event as an SSE frame: the `type` is the `event:` name, the whole event
// is the JSON `data:`. Query events carry no `seq`. Shared by the API writer,
// the browser reader, and the Seam 1 test so the frame format is defined once.
export function queryEventFrame(event: QueryEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// Parse one SSE frame back to a `QueryEvent`, or null if the frame has no
// `data:` line or the payload is not a valid event.
export function parseQueryEventFrame(frame: string): QueryEvent | null {
  const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
  if (!dataLine) return null;
  try {
    const parsed = QueryEvent.safeParse(
      JSON.parse(dataLine.slice('data:'.length).trim()),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
