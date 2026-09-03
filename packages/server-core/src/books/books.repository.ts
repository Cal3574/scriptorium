import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '@scriptorium/database/client';
import { books, chapters } from '@scriptorium/database/schema';
import { asc, count, desc, eq } from 'drizzle-orm';
import { DB } from '../database/database.module.js';

// A `books` row exactly as Drizzle selects it. The API mappers strip the
// storage-only columns (`s3Key`, `extractedMarkdownKey`, ...) before the shape
// crosses the wire.
export type BookRow = typeof books.$inferSelect;

// One `chapters` row as Drizzle selects it. The API mapper drops `bookId`,
// `updatedAt` and never exposes the chunk rows underneath.
export type ChapterRow = typeof chapters.$inferSelect;

// `PATCH /api/v1/books/:id` payload. A key that is absent is left untouched;
// `author: null` is an explicit clear.
export interface UpdateBookInput {
  title?: string;
  author?: string | null;
}

export interface CreateBookInput {
  userId: string;
  title: string | null;
  originalFilename: string;
  s3Key: string;
  fileSizeBytes: number;
}

export interface CreateBookResult {
  book: BookRow;
  // False when a row for this `s3Key` already existed - the create was a
  // replay of `POST /books` and `book` is the row from the first call.
  created: boolean;
}

/**
 * The HTTP layer's reader and writer for the `books` table and its `chapters`
 * children. The ingest worker owns every pipeline status transition and
 * artifact write; this repository lands the initial `pending` row, flips a
 * book to `deleting`, applies a user's title/author correction, and serves the
 * library list and Book-detail reads.
 */
@Injectable()
export class BooksRepository {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  /**
   * Land the initial `pending` row. The `s3_key` unique index makes this
   * idempotent: a replayed `POST /books` for a key that already has a row
   * returns that row with `created: false` rather than raising a unique
   * violation (which would surface as a generic 500).
   */
  async create(input: CreateBookInput): Promise<CreateBookResult> {
    const [inserted] = await this.db
      .insert(books)
      .values({
        userId: input.userId,
        title: input.title,
        originalFilename: input.originalFilename,
        s3Key: input.s3Key,
        fileSizeBytes: input.fileSizeBytes,
      })
      .onConflictDoNothing({ target: books.s3Key })
      .returning();

    if (inserted) return { book: inserted, created: true };

    const [existing] = await this.db
      .select()
      .from(books)
      .where(eq(books.s3Key, input.s3Key))
      .limit(1);
    return { book: existing, created: false };
  }

  /**
   * Mark a book `deleting`. The only `books` write the HTTP layer makes after
   * the initial `pending` row: `DELETE /books/:id` flips the status here and
   * then hands the actual teardown to the ingest worker's delete job. A book
   * already `deleting` is left as-is (the endpoint is a no-op).
   */
  async markDeleting(id: string): Promise<void> {
    await this.db
      .update(books)
      .set({ status: 'deleting', updatedAt: new Date() })
      .where(eq(books.id, id));
  }

  /** The owner's books, newest first. */
  async listByUser(userId: string): Promise<BookRow[]> {
    return this.db
      .select()
      .from(books)
      .where(eq(books.userId, userId))
      .orderBy(desc(books.createdAt));
  }

  /**
   * One book by id, or null. Used by the SSE progress endpoint to ownership-
   * check the caller and to build the opening snapshot, and to poll for the
   * row's disappearance on each keep-alive.
   */
  async findById(id: string): Promise<BookRow | null> {
    const [row] = await this.db
      .select()
      .from(books)
      .where(eq(books.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * A book's chapters in reading order, for the `GET /books/:id` detail
   * payload. Never joins or exposes the chunk rows beneath each chapter.
   */
  async findChapters(bookId: string): Promise<ChapterRow[]> {
    return this.db
      .select()
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .orderBy(asc(chapters.chapterIndex));
  }

  /**
   * Apply a `PATCH /books/:id` to the `books` row and return the updated row.
   * Only the keys present in `input` are written; `author: null` is an
   * explicit clear. A user-set `title` is authoritative from here on - the
   * `identifyBook` stage's completeness check already treats a non-null title
   * as done, and `recordIdentification` never overwrites a set column.
   */
  async update(id: string, input: UpdateBookInput): Promise<BookRow | null> {
    const patch: Partial<typeof books.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.author !== undefined) patch.author = input.author;

    const [row] = await this.db
      .update(books)
      .set(patch)
      .where(eq(books.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Chapter counts for a book's snapshot: total detected, and how many have a
   * summary (`count()` over a column ignores nulls).
   */
  async countChapters(
    bookId: string,
  ): Promise<{ total: number; summarized: number }> {
    const [row] = await this.db
      .select({
        total: count(),
        summarized: count(chapters.summary),
      })
      .from(chapters)
      .where(eq(chapters.bookId, bookId));
    return {
      total: row?.total ?? 0,
      summarized: row?.summarized ?? 0,
    };
  }
}
