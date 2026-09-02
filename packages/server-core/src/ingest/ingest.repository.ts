import { Inject, Injectable } from '@nestjs/common';
import type { BookStatus } from '@scriptorium/contracts';
import type { DbClient } from '@scriptorium/database/client';
import { books, chapters, chunks } from '@scriptorium/database/schema';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
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
   * `embed` stage progress counters: how many chunks the book has, and how
   * many still have `embedding is null`. Complete once `total > 0` and
   * `unembedded === 0`.
   */
  async chunkEmbeddingCounts(
    bookId: string,
  ): Promise<{ total: number; unembedded: number }> {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        unembedded: sql<number>`count(*) filter (where ${chunks.embedding} is null)::int`,
      })
      .from(chunks)
      .where(eq(chunks.bookId, bookId));
    return {
      total: row?.total ?? 0,
      unembedded: row?.unembedded ?? 0,
    };
  }

  /**
   * The chunks still awaiting an embedding, `chunk_index` order, so the embed
   * stage slices them into fixed-size batches and a resumed run picks up only
   * what is left.
   */
  async listUnembeddedChunks(
    bookId: string,
  ): Promise<{ id: string; text: string }[]> {
    return this.db
      .select({ id: chunks.id, text: chunks.chunkText })
      .from(chunks)
      .where(and(eq(chunks.bookId, bookId), isNull(chunks.embedding)))
      .orderBy(asc(chunks.chunkIndex));
  }

  /**
   * `embed` stage write-back for one batch: fill `embedding` for each chunk id
   * in a single transaction, so the batch flips to "done" atomically and a
   * crash resumes from the next null.
   */
  async writeChunkEmbeddings(
    rows: { id: string; embedding: number[] }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const row of rows) {
        await tx
          .update(chunks)
          .set({ embedding: row.embedding })
          .where(eq(chunks.id, row.id));
      }
    });
  }

  /** Total detected chapters for the book (the `chapterSummary` progress total). */
  async countChapters(bookId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(chapters)
      .where(eq(chapters.bookId, bookId));
    return row?.count ?? 0;
  }

  /** Chapters still missing a deep-dive summary (`chapterSummary` resumption). */
  async countChaptersMissingSummary(bookId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(chapters)
      .where(and(eq(chapters.bookId, bookId), isNull(chapters.summary)));
    return row?.count ?? 0;
  }

  /**
   * The chapters the `chapterSummary` stage still has to write, in
   * `chapter_index` order.
   */
  async listChaptersMissingSummary(bookId: string): Promise<
    {
      id: string;
      chapterIndex: number;
      title: string | null;
      pageStart: number | null;
      pageEnd: number | null;
    }[]
  > {
    return this.db
      .select({
        id: chapters.id,
        chapterIndex: chapters.chapterIndex,
        title: chapters.title,
        pageStart: chapters.pageStart,
        pageEnd: chapters.pageEnd,
      })
      .from(chapters)
      .where(and(eq(chapters.bookId, bookId), isNull(chapters.summary)))
      .orderBy(asc(chapters.chapterIndex));
  }

  /** `chapterSummary` per-chapter write-back. */
  async writeChapterSummary(chapterId: string, summary: string): Promise<void> {
    await this.db
      .update(chapters)
      .set({ summary, updatedAt: new Date() })
      .where(eq(chapters.id, chapterId));
  }

  /**
   * Every chapter summary the `bookSummary` reduce reads, `chapter_index`
   * order. Each row's `summary` is non-null (the stage only runs once
   * `chapterSummary` is complete).
   */
  async listChapterSummaries(
    bookId: string,
  ): Promise<{ title: string | null; summary: string }[]> {
    const rows = await this.db
      .select({ title: chapters.title, summary: chapters.summary })
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .orderBy(asc(chapters.chapterIndex));
    return rows
      .filter((r): r is { title: string | null; summary: string } =>
        Boolean(r.summary),
      )
      .map((r) => ({ title: r.title, summary: r.summary }));
  }

  /** `bookSummary` write-back: the whole-book summary and its generated-at stamp. */
  async writeBookSummary(bookId: string, summary: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(books)
      .set({ summary, summaryGeneratedAt: now, updatedAt: now })
      .where(eq(books.id, bookId));
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
