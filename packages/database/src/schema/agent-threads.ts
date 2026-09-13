import {
  bigint,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
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
    // Context-window trimming (#158). Both null until the thread first crosses
    // the message-count threshold - a fresh or short thread is unaffected.
    // `runningSummary` folds every message at or before
    // `summarizedThroughSeq` into one string, regenerated (not appended) each
    // time the threshold re-crosses; messages after that boundary are still
    // replayed verbatim. A `seq` boundary rather than a timestamp one
    // deliberately - see `agent_messages.seq` for why a timestamp can't
    // safely break a same-tick tie for this same adjacency-sensitive
    // ordering.
    runningSummary: text('running_summary'),
    summarizedThroughSeq: bigint('summarized_through_seq', {
      mode: 'number',
    }),
  },
  (table) => [
    uniqueIndex('agent_threads_user_id_book_id_key').on(
      table.userId,
      table.bookId,
    ),
  ],
);
