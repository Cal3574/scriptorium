import { z } from 'zod';
import { isoTimestamp, uuid } from './primitives.js';

// The reading-companion Agent: an ongoing, per-(reader, book) conversation.
// Parallel to - never replacing - the legacy one-shot `query.ts` contract, so
// Ask library keeps its own event shapes untouched.

// The endpoint enforces these bounds itself so it can return the specific
// problem code (a schema `.max()` would collapse into `validation_failed`).
export const AGENT_MESSAGE_MAX = 2000;

// The highlight-to-discuss seed. Generous: multi-paragraph selections are
// supported, and the reader-side selection handler truncates to this rather
// than blocking an over-long selection.
export const HIGHLIGHTED_PASSAGE_MAX = 4000;

export const AgentMessageRole = z.enum(['user', 'assistant']);
export type AgentMessageRole = z.infer<typeof AgentMessageRole>;

// One persisted turn-half. `highlightedPassage` is structurally separate from
// `message` so the UI renders it as its own quoted block; it is always null on
// an assistant row. There is no citations field - Agent mode has no retrieval.
export const AgentMessageDto = z.object({
  id: uuid,
  role: AgentMessageRole,
  message: z.string(),
  highlightedPassage: z.string().nullable(),
  createdAt: isoTimestamp,
});
export type AgentMessageDto = z.infer<typeof AgentMessageDto>;

// `GET /api/v1/books/:bookId/agent-thread` - the thread for one book, oldest
// message first. A user message with no assistant message after it is a failed
// turn; the client renders it as unanswered.
//
// `id` and `createdAt` are null when no thread exists for the book yet: reading
// deliberately does not create one (only sending does), so an untouched book
// reports an empty conversation rather than a `404`.
export const AgentThreadDto = z.object({
  id: uuid.nullable(),
  bookId: uuid,
  createdAt: isoTimestamp.nullable(),
  messages: z.array(AgentMessageDto),
});
export type AgentThreadDto = z.infer<typeof AgentThreadDto>;

// `POST /api/v1/books/:bookId/agent-messages`. `highlightedPassage` is present
// only on a highlight-to-discuss send.
export const CreateAgentMessageRequest = z.object({
  message: z.string().min(1),
  highlightedPassage: z.string().min(1).optional(),
});
export type CreateAgentMessageRequest = z.infer<
  typeof CreateAgentMessageRequest
>;

// --- Agent SSE stream. Read on the client with fetch() + a ReadableStream
// reader, not EventSource. The `type` field is the SSE `event:` name. Event
// names are distinct from the query stream's so a client can never confuse the
// two contracts. ---

// Emitted once the user's message is durably persisted, before generation
// starts - so the client can pin the optimistic bubble to a real row even if
// the turn later fails.
export const AgentTurnStartedEvent = z.object({
  type: z.literal('agent_turn_started'),
  threadId: uuid,
  userMessageId: uuid,
});

export const AgentTextDeltaEvent = z.object({
  type: z.literal('agent_text_delta'),
  text: z.string(),
});

// Emitted only once the assistant row is written - `messageId` is that row.
export const AgentDoneEvent = z.object({
  type: z.literal('agent_done'),
  messageId: uuid,
  message: z.string(),
});

// A failed turn. The user message stays persisted and unanswered; no assistant
// row exists, and the next turn's history reassembly skips the pair.
export const AgentErrorEvent = z.object({
  type: z.literal('agent_error'),
  message: z.string(),
});

export const AgentEvent = z.discriminatedUnion('type', [
  AgentTurnStartedEvent,
  AgentTextDeltaEvent,
  AgentDoneEvent,
  AgentErrorEvent,
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

// One event as an SSE frame: the `type` is the `event:` name, the whole event
// is the JSON `data:`. Shared by the API writer, the browser reader and the
// integration test so the frame format is defined once.
export function agentEventFrame(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// Parse one SSE frame back to an `AgentEvent`, or null if the frame has no
// `data:` line or the payload is not a valid event.
export function parseAgentEventFrame(frame: string): AgentEvent | null {
  const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
  if (!dataLine) return null;
  try {
    const parsed = AgentEvent.safeParse(
      JSON.parse(dataLine.slice('data:'.length).trim()),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
