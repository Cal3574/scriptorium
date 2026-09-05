import { Inject, Injectable } from '@nestjs/common';
import type { PersistedCitation } from '@scriptorium/contracts';
import type { DbClient } from '@scriptorium/database/client';
import { queries } from '@scriptorium/database/schema';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';

// One row from the pgvector candidate query. `similarity` is `1 - (embedding
// <=> $q)` - cosine similarity, not distance.
export interface CandidateRow {
  chunkId: string;
  bookId: string;
  bookTitle: string;
  chapterTitle: string;
  chunkText: string;
  similarity: number;
}

export interface RetrieveCandidatesInput {
  userId: string;
  // Null for a cross-book query.
  bookId: string | null;
  // The question embedding, EMBEDDING_DIMENSIONS long.
  queryEmbedding: number[];
  efSearch: number;
  poolLimit: number;
}

/**
 * The RAG query path's reader and writer for the `queries` table and its one
 * hot read of `chunks`. Retrieval is a single indexed single-table query with
 * `user_id` always bound (see rag-query-spec 2.2); persistence is the pending
 * insert at `query_started` and one `UPDATE` at `done`.
 */
@Injectable()
export class QueriesRepository {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  /**
   * The candidate pool: cosine `<=>` against the HNSW index, `user_id` always
   * bound, optional single-book filter as one nullable param, `LIMIT
   * poolLimit`. `SET LOCAL hnsw.ef_search` is scoped to the transaction.
   */
  async retrieveCandidates(
    input: RetrieveCandidatesInput,
  ): Promise<CandidateRow[]> {
    const vectorLiteral = `[${input.queryEmbedding.join(',')}]`;

    return this.db.transaction(async (tx) => {
      // `SET LOCAL` takes no bind parameters; the value is a schema-coerced
      // integer so interpolation is safe.
      await tx.execute(
        sql.raw(`SET LOCAL hnsw.ef_search = ${Math.trunc(input.efSearch)}`),
      );

      const result = await tx.execute<{
        chunk_id: string;
        book_id: string;
        book_title: string;
        chapter_title: string;
        chunk_text: string;
        similarity: number | string;
      }>(sql`
        SELECT id AS chunk_id,
               book_id,
               book_title,
               chapter_title,
               chunk_text,
               1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
        FROM chunks
        WHERE user_id = ${input.userId}
          AND embedding IS NOT NULL
          AND (${input.bookId}::uuid IS NULL OR book_id = ${input.bookId})
        ORDER BY embedding <=> ${vectorLiteral}::vector
        LIMIT ${input.poolLimit}
      `);

      return result.rows.map((row) => ({
        chunkId: row.chunk_id,
        bookId: row.book_id,
        bookTitle: row.book_title,
        chapterTitle: row.chapter_title,
        chunkText: row.chunk_text,
        similarity: Number(row.similarity),
      }));
    });
  }

  /** Land the pending row (`answer = null`, `citations = null`) before the stream opens. */
  async insertPending(input: {
    userId: string;
    question: string;
    bookId: string | null;
  }): Promise<string> {
    const [row] = await this.db
      .insert(queries)
      .values({
        userId: input.userId,
        question: input.question,
        bookId: input.bookId,
      })
      .returning({ id: queries.id });
    return row.id;
  }

  /**
   * The one `UPDATE` at `done`: write `answer` and the frozen `citations`
   * snapshot. On `error` or client disconnect this is never called, so the
   * row keeps `answer = null` and shows in history as failed.
   */
  async complete(
    id: string,
    result: { answer: string; citations: PersistedCitation[] },
  ): Promise<void> {
    await this.db
      .update(queries)
      .set({ answer: result.answer, citations: result.citations })
      .where(eq(queries.id, id));
  }
}
