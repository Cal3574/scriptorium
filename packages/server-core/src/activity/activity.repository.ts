import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '@scriptorium/database/client';
import { books, queries } from '@scriptorium/database/schema';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { DB } from '../database/database.module.js';

export interface ActivityTotals {
  books: number;
  questions: number;
  pagesIngested: number;
}

export interface TopBookByQuestions {
  bookId: string;
  title: string;
  questionCount: number;
}

// A `YYYY-MM` (UTC) key mapped to a row count, as produced by a
// `group by date_trunc('month', ...)` read. `buildMonthlyActivity` turns two
// of these into the zero-filled 12-month series.
export type MonthlyCounts = Map<string, number>;

// The `date_trunc('month', <ts> AT TIME ZONE 'UTC')` bucket key. `created_at`
// is `timestamptz`; `AT TIME ZONE 'UTC'` pins the wall-clock month to UTC so
// the buckets match `billing-period`'s UTC calendar-month convention
// regardless of the database session timezone.
const bookMonth = sql<string>`to_char(date_trunc('month', ${books.createdAt} at time zone 'UTC'), 'YYYY-MM')`;
const queryMonth = sql<string>`to_char(date_trunc('month', ${queries.createdAt} at time zone 'UTC'), 'YYYY-MM')`;

/**
 * Every read behind `GET /me/activity`, in one place so the dashboard's data
 * shape and the SQL that feeds it evolve together. All reads are scoped to a
 * single `userId` and covered by the existing `books_user_id_idx` /
 * `queries_user_id_created_at_idx` indexes.
 */
@Injectable()
export class ActivityRepository {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  /**
   * Lifetime counts. Every row is counted (a `failed` book, a query whose
   * synthesis failed) to match the entitlement guard's "a row is a slot"
   * rule. `pagesIngested` sums `books.page_count`, which is set at the
   * `extract` stage; a book that never reached extraction has a null count
   * and contributes nothing.
   */
  async lifetimeTotals(userId: string): Promise<ActivityTotals> {
    const [bookRow, queryRow] = await Promise.all([
      this.db
        .select({
          total: count(),
          pages: sql<number>`coalesce(sum(${books.pageCount}), 0)::int`,
        })
        .from(books)
        .where(eq(books.userId, userId)),
      this.db
        .select({ total: count() })
        .from(queries)
        .where(eq(queries.userId, userId)),
    ]);

    return {
      books: bookRow[0]?.total ?? 0,
      questions: queryRow[0]?.total ?? 0,
      pagesIngested: bookRow[0]?.pages ?? 0,
    };
  }

  /** Book uploads per UTC calendar month, from `since` onward. */
  async monthlyBookUploads(
    userId: string,
    since: Date,
  ): Promise<MonthlyCounts> {
    const rows = await this.db
      .select({ month: bookMonth, total: count() })
      .from(books)
      .where(and(eq(books.userId, userId), gte(books.createdAt, since)))
      .groupBy(bookMonth);
    return new Map(rows.map((r) => [r.month, r.total]));
  }

  /** Questions asked per UTC calendar month, from `since` onward. */
  async monthlyQuestions(userId: string, since: Date): Promise<MonthlyCounts> {
    const rows = await this.db
      .select({ month: queryMonth, total: count() })
      .from(queries)
      .where(and(eq(queries.userId, userId), gte(queries.createdAt, since)))
      .groupBy(queryMonth);
    return new Map(rows.map((r) => [r.month, r.total]));
  }

  /**
   * The reader's most-asked books, most first, ties broken by the most recent
   * question. Only book-filtered questions against a book the reader still
   * owns are counted - an unfiltered question has a null `book_id`, and a
   * deleted book's questions had theirs set to null - so the inner join
   * silently drops both. `title` falls back to the original filename until
   * the identify stage backfills it.
   */
  async topBooksByQuestions(
    userId: string,
    limit: number,
  ): Promise<TopBookByQuestions[]> {
    const questionCount = count();
    const lastAsked = sql<string>`max(${queries.createdAt})`;
    const rows = await this.db
      .select({
        bookId: books.id,
        title: sql<string>`coalesce(nullif(${books.title}, ''), ${books.originalFilename})`,
        questionCount,
      })
      .from(queries)
      .innerJoin(books, eq(books.id, queries.bookId))
      .where(eq(queries.userId, userId))
      .groupBy(books.id)
      .orderBy(desc(questionCount), desc(lastAsked))
      .limit(limit);
    return rows;
  }
}
