import { pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { books } from './books.js';
import { users } from './users.js';

// One reading-companion conversation per (reader, book). The unique constraint
// *is* the lookup contract: the endpoint find-or-creates against it rather than
// carrying a thread id in the URL, so a reader who highlights a passage never
// has to have "started" a thread first.
//
// CASCADE on both parents: a thread is meaningless without the book it is about.
export const agentThreads = pgTable(
  'agent_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_threads_user_id_book_id_key').on(
      table.userId,
      table.bookId,
    ),
  ],
);
