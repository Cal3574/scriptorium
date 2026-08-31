import { pgEnum } from 'drizzle-orm/pg-core';

// The one native Postgres enum in the schema. Small, stable value set; compact
// and type-safe. `status` is display / SSE state only - never the source of
// truth for pipeline resumption (that is derive-from-data). `chapters` has no
// status enum: a chapter's two observable states are derivable from
// `summary is null`.
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
