import { FakeLlmClient } from '@scriptorium/providers';
import type {
  AgentMessageRow,
  AgentRepository,
  AgentThreadRow,
} from '@scriptorium/server-core';
import {
  CONTEXT_TRIM_THRESHOLD,
  CONTEXT_VERBATIM_TURNS,
  maybeTrimThread,
} from './context-window';

// An in-memory stand-in for `AgentRepository`, implementing only the three
// methods `maybeTrimThread` calls. Backed by a plain array so a test can seed
// turns and then inspect exactly what got written, without a real database.
class InMemoryAgentThread {
  messages: AgentMessageRow[] = [];
  runningSummary: string | null = null;
  summarizedThroughSeq: number | null = null;

  constructor(private readonly threadId: string) {}

  seedTurns(count: number, startIndex = 0): void {
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    for (let i = 0; i < count; i++) {
      const n = startIndex + i;
      this.messages.push(
        {
          id: `user-${n}`,
          threadId: this.threadId,
          role: 'user',
          message: `turn ${n} question`,
          highlightedPassage: n === 0 ? 'the seed passage' : null,
          seq: this.messages.length,
          createdAt: new Date(base + n * 2000),
        },
        {
          id: `assistant-${n}`,
          threadId: this.threadId,
          role: 'assistant',
          message: `turn ${n} answer`,
          highlightedPassage: null,
          seq: this.messages.length + 1,
          createdAt: new Date(base + n * 2000 + 1000),
        },
      );
    }
  }

  asRepository(): AgentRepository {
    return {
      countMessagesSince: async (_threadId: string, sinceSeq: number | null) =>
        this.messages.filter((m) => sinceSeq === null || m.seq > sinceSeq)
          .length,
      listMessages: async () => this.messages,
      updateSummary: async (
        _threadId: string,
        runningSummary: string,
        summarizedThroughSeq: number,
      ) => {
        this.runningSummary = runningSummary;
        this.summarizedThroughSeq = summarizedThroughSeq;
      },
    } as unknown as AgentRepository;
  }

  asThreadRow(): AgentThreadRow {
    return {
      id: this.threadId,
      userId: 'user',
      bookId: 'book',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      runningSummary: this.runningSummary,
      summarizedThroughSeq: this.summarizedThroughSeq,
    };
  }
}

describe('maybeTrimThread', () => {
  const llm = new FakeLlmClient({ delayMs: 0 });

  it('is a no-op below the trim threshold', async () => {
    const state = new InMemoryAgentThread('t1');
    state.seedTurns(CONTEXT_TRIM_THRESHOLD / 2 - 1); // well under 40 rows

    await maybeTrimThread(llm, state.asRepository(), state.asThreadRow());

    expect(state.runningSummary).toBeNull();
    expect(state.summarizedThroughSeq).toBeNull();
  });

  it('folds everything but the most recent verbatim turns into a summary once the threshold crosses', async () => {
    const state = new InMemoryAgentThread('t1');
    const totalTurns = CONTEXT_TRIM_THRESHOLD / 2; // exactly 40 rows
    state.seedTurns(totalTurns);

    await maybeTrimThread(llm, state.asRepository(), state.asThreadRow());

    expect(state.runningSummary).not.toBeNull();
    expect(state.summarizedThroughSeq).not.toBeNull();

    // The boundary lands exactly after the last folded turn's assistant reply
    // - the turn just before the verbatim window starts.
    const foldedCount = totalTurns - CONTEXT_VERBATIM_TURNS;
    const lastFoldedAssistant = state.messages.find(
      (m) => m.id === `assistant-${foldedCount - 1}`,
    );
    expect(state.summarizedThroughSeq).toEqual(lastFoldedAssistant?.seq);
  });

  it('regenerates the summary rather than appending to it on a later re-cross', async () => {
    const state = new InMemoryAgentThread('t1');
    state.seedTurns(CONTEXT_TRIM_THRESHOLD / 2);
    await maybeTrimThread(llm, state.asRepository(), state.asThreadRow());
    const firstSummary = state.runningSummary;
    const firstBoundary = state.summarizedThroughSeq;

    // Enough further rows to make the unsummarized count cross the threshold
    // again (20 already-verbatim + 20 new = 40).
    state.seedTurns(CONTEXT_VERBATIM_TURNS, CONTEXT_TRIM_THRESHOLD / 2);
    await maybeTrimThread(llm, state.asRepository(), state.asThreadRow());

    expect(state.runningSummary).not.toBeNull();
    expect(state.runningSummary).not.toEqual(firstSummary);
    expect(state.summarizedThroughSeq).not.toEqual(firstBoundary);
    expect((state.summarizedThroughSeq ?? 0) > (firstBoundary ?? 0)).toBe(true);
  });

  it('never picks a boundary that would split a turn in half', async () => {
    const state = new InMemoryAgentThread('t1');
    // A couple of completed turns, then a failed one interspersed among the
    // older rows, then enough further completed turns to cross the
    // threshold - the failed row must not confuse the boundary choice into
    // landing on an unpaired row.
    state.seedTurns(2);
    state.messages.push({
      id: 'user-failed',
      threadId: 't1',
      role: 'user',
      message: 'a failed retry',
      highlightedPassage: null,
      seq: state.messages.length,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 4, 500)),
    });
    state.seedTurns(CONTEXT_TRIM_THRESHOLD / 2 - 2, 2);

    await maybeTrimThread(llm, state.asRepository(), state.asThreadRow());

    const boundary = state.summarizedThroughSeq;
    expect(boundary).not.toBeNull();
    const boundaryRow = state.messages.find((m) => m.seq === boundary);
    expect(boundaryRow?.role).toBe('assistant');
  });
});
