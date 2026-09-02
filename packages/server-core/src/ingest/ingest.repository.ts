import { Inject, Injectable } from '@nestjs/common';
import type { BookStatus } from '@scriptorium/contracts';
import type { DbClient } from '@scriptorium/database/client';
import { books } from '@scriptorium/database/schema';
import { eq } from 'drizzle-orm';
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

/**
 * The ingest worker's writer for the `books` table. Kept apart from the
 * HTTP-layer {@link BooksRepository} (which only ever lands the initial
 * `pending` row): every later status transition and artifact write is the
 * worker's, and the pipeline stages derive resumption from the columns this
 * repository sets - never from `status`.
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
