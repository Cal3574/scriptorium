import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { books } from './books.js';
import { users } from './users.js';
import type { PersistedCitation } from '@scriptorium/contracts';

// One row per RAG query. Persisting the result lets the user revisit past
// answers without re-running a paid multi-second synthesis.
export const queries = pgTable(
  'queries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    // Null if synthesis failed.
    answer: text('answer'),
    // The optional single-book filter. SET NULL, not CASCADE: the history
    // entry survives a deleted book, it just loses its filter pointer.
    bookId: uuid('book_id').references(() => books.id, {
      onDelete: 'set null',
    }),
    // Self-contained frozen snapshot: display text, not live foreign keys, so
    // a history entry still renders after a cited book is deleted.
    citations: jsonb('citations').$type<PersistedCitation[]>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('queries_user_id_created_at_idx').on(
      table.userId,
      table.createdAt.desc(),
    ),
  ],
);
