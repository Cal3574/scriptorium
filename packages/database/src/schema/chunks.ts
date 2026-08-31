import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { books } from './books.js';
import { chapters } from './chapters.js';
import { users } from './users.js';

// One row per sub-chapter chunk (~600 tokens). `book_id` and `user_id` are
// denormalised alongside the `chapter_id` parent so the RAG hot path is a
// single-table indexed query with no joins. Both are immutable after insert -
// book ownership never transfers - so there is no sync hazard.
//
// `book_title` and `chapter_title` are likewise denormalised (written at
// chunk-insert time from the values already in memory) so the RAG candidate
// query and the citation payload read everything from `chunks` alone.
//
// STALENESS: `books.title` is mutable (a PATCH or the identifyBook stage can
// change it), so `chunks.book_title` DRIFTS from `books.title` after a rename.
// This is accepted: the drift is cosmetic (the sources-panel label on new
// queries only), query history is a frozen jsonb snapshot and unaffected, and
// re-chunking on every title edit would be absurd. `chapters.title` is
// effectively immutable once detected, so `chunks.chapter_title` never drifts.
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 0-based order within the book.
    chunkIndex: integer('chunk_index').notNull(),
    // Verbatim ~600-token slice; shown under the RAG answer.
    chunkText: text('chunk_text').notNull(),
    // Denormalised citation labels - see the staleness note above.
    bookTitle: text('book_title').notNull(),
    chapterTitle: text('chapter_title').notNull(),
    tokenCount: integer('token_count'),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    // OpenAI `text-embedding-3-small`, native 1536 dims. Null until the embed
    // stage fills it - which is what makes a partial embed stage resumable.
    embedding: vector('embedding', { dimensions: 1536 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('chunks_book_id_chunk_index_key').on(
      table.bookId,
      table.chunkIndex,
    ),
    index('chunks_chapter_id_idx').on(table.chapterId),
    // The embed stage's "next batch to embed" query.
    index('chunks_book_id_unembedded_idx')
      .on(table.bookId)
      .where(sql`${table.embedding} is null`),
    // The RAG hot path. HNSW (builds incrementally as books are ingested one
    // at a time), cosine ops (OpenAI vectors are normalised), partial so
    // un-embedded chunks stay out of the index.
    index('chunks_embedding_hnsw')
      .using('hnsw', table.embedding.op('vector_cosine_ops'))
      .with({ m: 16, ef_construction: 64 })
      .where(sql`${table.embedding} is not null`),
  ],
);
