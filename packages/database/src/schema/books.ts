import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bookStatus } from './enums.js';
import { users } from './users.js';

// One row per uploaded book. `title` and `author` are nullable and backfilled
// during the extract stage (a cheap Claude call over the first ~2 pages), or
// overridden by a client-supplied title on `POST /books`. Until backfill,
// Library and Book-detail render `original_filename`.
export const books = pgTable(
  'books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    author: text('author'),
    originalFilename: text('original_filename').notNull(),
    // The presigned-PUT target for the original PDF. Unique - idempotent
    // upload handoff.
    s3Key: text('s3_key').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
    pageCount: integer('page_count'),
    // S3 object key for the full LlamaParse markdown blob.
    extractedMarkdownKey: text('extracted_markdown_key'),
    // Whole-book high-level summary, markdown. Null until the book-summary
    // stage completes.
    summary: text('summary'),
    summaryGeneratedAt: timestamp('summary_generated_at', {
      withTimezone: true,
    }),
    status: bookStatus('status').notNull().default('pending'),
    // Set on failure, e.g. 'embedding'.
    failedStage: text('failed_stage'),
    // User-facing failure message.
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('books_s3_key_key').on(table.s3Key),
    index('books_user_id_idx').on(table.userId),
  ],
);
