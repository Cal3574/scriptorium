import { Inject, Injectable } from '@nestjs/common';
import type { BookStatus } from '@scriptorium/contracts';
import type { DbClient } from '@scriptorium/database/client';
import { books, chapters, chunks } from '@scriptorium/database/schema';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { BookRow } from '../books/books.repository.js';

export interface ExtractionResult {
  extractedMarkdownKey: string;
  pageCount: number;
}

export interface Identification {
  title: string | null;
  author: string | null;
}

export interface FailureMark {
  failedStage: string;
  failureReason: string;
}

export interface ChunkInput {
  chunkText: string;
  tokenCount: number | null;
  pageStart: number | null;
  pageEnd: number | null;
}

export interface ChapterInput {
  chapterIndex: number;
  title: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  // The non-null value stamped onto every `chunks.chapter_title` in this
  // chapter (the `chapters.title` above may be null; a chunk row's is not).
  chunkRowChapterTitle: string;
  chunks: ChunkInput[];
}

export interface WriteChaptersInput {
  bookId: string;
  userId: string;
  bookTitle: string;
  chapters: ChapterInput[];
}

/**
 * The ingest worker's writer for the `books` table and its `chapters` /
 * `chunks` children. Kept apart from the HTTP-layer {@link BooksRepository}
 * (which only ever lands the initial `pending` row): every later status
 * transition and artifact write is the worker's, and the pipeline stages
 * derive resumption from the rows this repository sets - never from `status`.
 */
@Injectable()
export class IngestRepository {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  async findById(bookId: string): Promise<BookRow | null> {
    const [row] = await this.db
      .select()
      .from(books)
      .where(eq(books.id, bookId))
      .limit(1);
    return row ?? null;
  }

  /** Move the book's display status. A no-op transition is still written. */
  async setStatus(bookId: string, status: BookStatus): Promise<void> {
    await this.db
      .update(books)
      .set({ status, updatedAt: new Date() })
      .where(eq(books.id, bookId));
  }

  /** `extract` stage checkpoint: the permanent markdown key and page count. */
  async recordExtraction(
    bookId: string,
    result: ExtractionResult,
  ): Promise<void> {
    await this.db
      .update(books)
      .set({
        extractedMarkdownKey: result.extractedMarkdownKey,
        pageCount: result.pageCount,
        updatedAt: new Date(),
      })
      .where(eq(books.id, bookId));
  }

  /**
   * `identifyBook` stage checkpoint. Only fills a column that is still null:
   * a user-supplied title (or author correction via `PATCH /books/:id`) is
   * authoritative and the LLM guess must never overwrite it.
   */
  async recordIdentification(
    bookId: string,
    identity: Identification,
  ): Promise<boolean> {
    const current = await this.findById(bookId);
    if (!current) return false;

    const patch: Partial<typeof books.$inferInsert> = {};
    if (current.title === null && identity.title) patch.title = identity.title;
    if (current.author === null && identity.author) {
      patch.author = identity.author;
    }
    if (Object.keys(patch).length === 0) return false;

    await this.db
      .update(books)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(books.id, bookId));
    return true;
  }

  /**
   * `chunk` stage completion check. True once at least one `chapters` row
   * exists for the book - the whole chapters + chunks write is one
   * transaction, so this is never half-true.
   */
  async hasChapters(bookId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(chapters)
      .where(eq(chapters.bookId, bookId));
    return (row?.count ?? 0) > 0;
  }

  /**
   * `chunk` stage checkpoint. Inserts every detected chapter and all of its
   * chunks in a single transaction: a crash leaves nothing behind, so a
   * re-run redoes the whole stage rather than resuming a half-written book.
   * `chunk_index` is assigned book-wide in chapter/chunk order.
   */
  async writeChaptersAndChunks(input: WriteChaptersInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      let chunkIndex = 0;
      for (const chapter of input.chapters) {
        const [inserted] = await tx
          .insert(chapters)
          .values({
            bookId: input.bookId,
            chapterIndex: chapter.chapterIndex,
            title: chapter.title,
            pageStart: chapter.pageStart,
            pageEnd: chapter.pageEnd,
          })
          .returning({ id: chapters.id });

        if (chapter.chunks.length === 0) continue;
        await tx.insert(chunks).values(
          chapter.chunks.map((chunk) => ({
            chapterId: inserted.id,
            bookId: input.bookId,
            userId: input.userId,
            chunkIndex: chunkIndex++,
            chunkText: chunk.chunkText,
            bookTitle: input.bookTitle,
            chapterTitle: chapter.chunkRowChapterTitle,
            tokenCount: chunk.tokenCount,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            embedding: null,
          })),
        );
      }
    });
  }

  /**
   * Hard-delete the book row. Postgres does the rest: `chapters` and `chunks`
   * cascade, and any `queries.book_id` that pointed here is set null (the
   * history entry keeps its frozen `citations` snapshot). Idempotent - a
   * second call for an already-gone id deletes zero rows.
   */
  async deleteBook(bookId: string): Promise<void> {
    await this.db.delete(books).where(eq(books.id, bookId));
  }

  /** Terminal failure: park the book as `failed` with a stage and a reason. */
  async markFailed(bookId: string, mark: FailureMark): Promise<void> {
    await this.db
      .update(books)
      .set({
        status: 'failed',
        failedStage: mark.failedStage,
        failureReason: mark.failureReason,
        updatedAt: new Date(),
      })
      .where(eq(books.id, bookId));
  }
}
