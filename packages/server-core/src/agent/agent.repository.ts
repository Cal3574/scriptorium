import { Inject, Injectable } from '@nestjs/common';
import type { AgentMessageRole } from '@scriptorium/contracts';
import type { DbClient } from '@scriptorium/database/client';
import { agentMessages, agentThreads } from '@scriptorium/database/schema';
import { and, asc, count, eq, gt, gte } from 'drizzle-orm';
import { currentMonthStartUtc } from '../entitlements/billing-period.js';
import { DB } from '../database/database.module.js';

export interface AgentThreadRow {
  id: string;
  userId: string;
  bookId: string;
  createdAt: Date;
  updatedAt: Date;
  // Context-window trimming (#158) - both null until the thread first crosses
  // the message-count threshold. `summarizedThroughSeq` is a `seq` boundary,
  // not a timestamp - see `agent_messages.seq` for why a timestamp can't
  // safely break a same-tick tie for this same adjacency-sensitive ordering.
  runningSummary: string | null;
  summarizedThroughSeq: number | null;
}

export interface AgentMessageRow {
  id: string;
  threadId: string;
  role: AgentMessageRole;
  message: string;
  highlightedPassage: string | null;
  seq: number;
  createdAt: Date;
}

export interface InsertAgentMessageInput {
  threadId: string;
  role: AgentMessageRole;
  message: string;
  // Only ever set on a user row, and only on a highlight-to-discuss send.
  highlightedPassage?: string | null;
}

/**
 * Reader and writer for `agent_threads` / `agent_messages` - the reading
 * companion's only persistence. No retrieval, no citations: a turn is two rows
 * at most.
 *
 * Turn durability is expressed purely in row order. {@link insertMessage} with
 * `role: 'user'` runs before generation starts, so the reader's words survive a
 * failure; the assistant row is only written once generation succeeds. A user
 * row with no assistant row after it is therefore a failed turn - see
 * `reassembleHistory` in the api app for how that shape is read back.
 */
@Injectable()
export class AgentRepository {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  /**
   * The thread for one (reader, book), created on first use. Races on the
   * unique index rather than reading first: two concurrent first sends both
   * attempt the insert, the loser's `ON CONFLICT DO NOTHING` returns no row,
   * and the follow-up select finds the winner's.
   */
  async findOrCreateThread(
    userId: string,
    bookId: string,
  ): Promise<AgentThreadRow> {
    const [inserted] = await this.db
      .insert(agentThreads)
      .values({ userId, bookId })
      .onConflictDoNothing({
        target: [agentThreads.userId, agentThreads.bookId],
      })
      .returning();
    if (inserted) return inserted;

    const existing = await this.findThreadByUserAndBook(userId, bookId);
    if (!existing) {
      // Only reachable if the row vanished between the conflict and the read.
      throw new Error(
        `agent thread for user ${userId} / book ${bookId} could not be created`,
      );
    }
    return existing;
  }

  async findThreadByUserAndBook(
    userId: string,
    bookId: string,
  ): Promise<AgentThreadRow | null> {
    const [row] = await this.db
      .select()
      .from(agentThreads)
      .where(
        and(eq(agentThreads.userId, userId), eq(agentThreads.bookId, bookId)),
      )
      .limit(1);
    return row ?? null;
  }

  /** One turn-half. Returns the new row's id so the stream can carry it. */
  async insertMessage(input: InsertAgentMessageInput): Promise<string> {
    const [row] = await this.db
      .insert(agentMessages)
      .values({
        threadId: input.threadId,
        role: input.role,
        message: input.message,
        highlightedPassage: input.highlightedPassage ?? null,
      })
      .returning({ id: agentMessages.id });
    return row.id;
  }

  /**
   * Every message in a thread, oldest first, ordered by `seq` (insertion order)
   * rather than `created_at` - history reassembly depends on a user row being
   * *immediately followed by* its assistant reply, and two rows landing inside
   * the same timestamp tick would make a `created_at` sort ambiguous. Covered
   * by `agent_messages_thread_id_created_at_idx`.
   */
  async listMessages(threadId: string): Promise<AgentMessageRow[]> {
    return this.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.threadId, threadId))
      .orderBy(asc(agentMessages.seq));
  }

  /** Bump `updated_at` so "most recently used thread" stays answerable. */
  async touchThread(threadId: string): Promise<void> {
    await this.db
      .update(agentThreads)
      .set({ updatedAt: new Date() })
      .where(eq(agentThreads.id, threadId));
  }

  /**
   * How many rows in this thread have not yet been folded into
   * `runningSummary` - the cheap `COUNT` that gates trimming, mirroring
   * {@link countMessagesThisMonth}'s pattern. `sinceSeq` is the thread's
   * current `summarizedThroughSeq` (null for a thread that has never been
   * trimmed, in which case every row counts).
   */
  async countMessagesSince(
    threadId: string,
    sinceSeq: number | null,
  ): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.threadId, threadId),
          sinceSeq !== null ? gt(agentMessages.seq, sinceSeq) : undefined,
        ),
      );
    return row?.total ?? 0;
  }

  /**
   * Replaces (never appends to) the thread's rolling summary and advances the
   * `seq` boundary it is summarized through. Called only from the trimming
   * pass - see `maybeTrimThread` in the api app.
   */
  async updateSummary(
    threadId: string,
    runningSummary: string,
    summarizedThroughSeq: number,
  ): Promise<void> {
    await this.db
      .update(agentThreads)
      .set({ runningSummary, summarizedThroughSeq })
      .where(eq(agentThreads.id, threadId));
  }

  /**
   * How many Agent turns the user has sent since the start of the current
   * calendar month in UTC - one row per turn, since only a `role: 'user'` row
   * is guaranteed to exist even for a failed turn. Summed with
   * `QueriesRepository.countThisMonth` by the entitlement guard and
   * `GET /me/usage`: an Agent turn spends the same pooled monthly allowance as
   * an Ask library question.
   */
  async countMessagesThisMonth(userId: string): Promise<number> {
    const monthStart = currentMonthStartUtc();
    const [row] = await this.db
      .select({ total: count() })
      .from(agentMessages)
      .innerJoin(agentThreads, eq(agentMessages.threadId, agentThreads.id))
      .where(
        and(
          eq(agentThreads.userId, userId),
          eq(agentMessages.role, 'user'),
          gte(agentMessages.createdAt, monthStart),
        ),
      );
    return row?.total ?? 0;
  }
}
