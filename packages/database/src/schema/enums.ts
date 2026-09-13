import { pgEnum } from 'drizzle-orm/pg-core';

// The schema's native Postgres enums. Small, stable value sets; compact and
// type-safe. `status` is display / SSE state only - never the source of truth
// for pipeline resumption (that is derive-from-data). `chapters` has no status
// enum: a chapter's two observable states are derivable from `summary is null`.
export const bookStatus = pgEnum('book_status', [
  'pending',
  'extracting',
  'chunking',
  'embedding',
  'summarizing',
  'ready',
  'failed',
  'deleting',
]);

// Who spoke in an Agent conversation turn. No 'system' member: the companion's
// system prompt is a code constant, never a persisted row.
export const agentMessageRole = pgEnum('agent_message_role', [
  'user',
  'assistant',
]);
