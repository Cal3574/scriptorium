import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { books } from './books.js';

// One row per detected chapter. Chapter detection is owned elsewhere; this
// table only holds the result. `title`, `page_start`, `page_end` are all
// nullable - the regex fallback may not capture a heading and LlamaParse page
// numbers can be missing.
export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    // 0-based order within the book.
    chapterIndex: integer('chapter_index').notNull(),
    title: text('title'),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    // Per-chapter deep-dive; null until the chapter-summary stage fills it.
    // `summary is null` / `is not null` is the chapter's entire state machine.
    summary: text('summary'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('chapters_book_id_chapter_index_key').on(
      table.bookId,
      table.chapterIndex,
    ),
    index('chapters_book_id_idx').on(table.bookId),
  ],
);
