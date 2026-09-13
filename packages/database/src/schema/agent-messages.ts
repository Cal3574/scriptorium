import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { agentThreads } from './agent-threads.js';
import { agentMessageRole } from './enums.js';

// One turn-half of an Agent conversation.
//
// `highlighted_passage` is deliberately its own column rather than being folded
// into `message`: it is the highlight-to-discuss seed, and the UI renders it as
// a distinct quoted block above the reader's own words. Null on assistant rows
// and on plain follow-up sends.
//
// There is no `citations` column - Agent mode has no retrieval. It is
// constrained to the highlighted passage and the thread's own history.
//
// Turn semantics live in the shape of the rows, not in a status column: the
// user row is written immediately on send, the assistant row only once
// generation succeeds. A user row with no assistant row after it is a failed
// turn - rendered as unanswered, and skipped when reassembling history.
export const agentMessages = pgTable(
  'agent_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => agentThreads.id, { onDelete: 'cascade' }),
    role: agentMessageRole('role').notNull(),
    message: text('message').notNull(),
    highlightedPassage: text('highlighted_passage'),
    // Insertion order, independent of `created_at`. History reassembly depends
    // on a user row being *immediately followed by* its assistant reply -
    // `id` is a random UUID and cannot break a same-tick tie, so this identity
    // column is the sort key that actually guarantees that adjacency.
    seq: bigint('seq', { mode: 'number' })
      .notNull()
      .generatedAlwaysAsIdentity(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('agent_messages_thread_id_created_at_idx').on(
      table.threadId,
      table.createdAt,
    ),
  ],
);
