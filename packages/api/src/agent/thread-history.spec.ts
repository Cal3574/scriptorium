import type { AgentMessageRow } from '@scriptorium/server-core';
import { buildPromptHistory, reassembleHistory } from './thread-history';

// Builds a row list from a compact `role:text` shorthand, stamped a second
// apart so ordering is unambiguous.
function rows(
  ...specs: Array<[AgentMessageRow['role'], string, string?]>
): AgentMessageRow[] {
  return specs.map(([role, message, highlightedPassage], i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    threadId: 'thread',
    role,
    message,
    highlightedPassage: highlightedPassage ?? null,
    seq: i,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
  }));
}

describe('reassembleHistory', () => {
  it('is empty for a thread with no messages', () => {
    expect(reassembleHistory([])).toEqual([]);
  });

  it('replays a completed turn as a user/assistant pair', () => {
    const history = reassembleHistory(
      rows(['user', 'why this line?'], ['assistant', 'what pulled you to it?']),
    );

    expect(history).toEqual([
      { role: 'user', content: 'why this line?' },
      { role: 'assistant', content: 'what pulled you to it?' },
    ]);
  });

  it('folds a highlighted passage into the user turn it was sent with', () => {
    const [first] = reassembleHistory(
      rows(['user', 'why this line?', 'the quoted text'], ['assistant', 'ok']),
    );

    expect(first.role).toBe('user');
    expect(first.content).toContain('the quoted text');
    expect(first.content).toContain('why this line?');
  });

  it('skips a failed turn - a user message with no assistant reply after it', () => {
    const history = reassembleHistory(
      rows(
        ['user', 'first'],
        ['assistant', 'first reply'],
        ['user', 'the turn that failed'],
        ['user', 'retry'],
        ['assistant', 'retry reply'],
      ),
    );

    expect(history.map((m) => m.content)).toEqual([
      'first',
      'first reply',
      'retry',
      'retry reply',
    ]);
  });

  it('skips a trailing unanswered user message', () => {
    const history = reassembleHistory(
      rows(['user', 'answered'], ['assistant', 'reply'], ['user', 'failed']),
    );

    expect(history.map((m) => m.content)).toEqual(['answered', 'reply']);
  });

  it('drops an orphaned assistant message with no user message before it', () => {
    const history = reassembleHistory(
      rows(['assistant', 'orphan'], ['user', 'q'], ['assistant', 'a']),
    );

    expect(history.map((m) => m.content)).toEqual(['q', 'a']);
  });
});

describe('buildPromptHistory', () => {
  it('behaves exactly like reassembleHistory below the trim threshold', () => {
    const messages = rows(
      ['user', 'why this line?', 'the quoted text'],
      ['assistant', 'ok'],
      ['user', 'say more'],
      ['assistant', 'sure'],
    );

    expect(
      buildPromptHistory(
        { runningSummary: null, summarizedThroughSeq: null },
        messages,
      ),
    ).toEqual(reassembleHistory(messages));
  });

  it('is empty for a thread with no messages', () => {
    expect(
      buildPromptHistory(
        { runningSummary: null, summarizedThroughSeq: null },
        [],
      ),
    ).toEqual([]);
  });

  it('prepends the rolling summary ahead of the verbatim tail', () => {
    const messages = rows(
      ['user', 'seed question', 'the passage'],
      ['assistant', 'seed reply'],
      ['user', 'recent question'],
      ['assistant', 'recent reply'],
    );
    const boundary = messages[1].seq; // through the seed turn

    const history = buildPromptHistory(
      {
        runningSummary: 'earlier reactions',
        summarizedThroughSeq: boundary,
      },
      messages,
    );

    expect(history[0]).toEqual({
      role: 'user',
      content: expect.stringContaining('earlier reactions'),
    });
  });

  it('pins the seed turn verbatim even once it ages out of the summarized region', () => {
    const messages = rows(
      ['user', 'seed question', 'the passage'],
      ['assistant', 'seed reply'],
      ['user', 'middle question'],
      ['assistant', 'middle reply'],
      ['user', 'recent question'],
      ['assistant', 'recent reply'],
    );
    // Summarized through the middle turn - only the seed and the recent turn
    // should reach the prompt.
    const boundary = messages[3].seq;

    const history = buildPromptHistory(
      {
        runningSummary: 'summary of the middle turn',
        summarizedThroughSeq: boundary,
      },
      messages,
    );

    expect(history.map((m) => m.content)).toEqual([
      expect.stringContaining('summary of the middle turn'),
      expect.stringContaining('seed question'),
      'seed reply',
      'recent question',
      'recent reply',
    ]);
  });

  it('does not duplicate the seed turn when it is still inside the verbatim window', () => {
    const messages = rows(
      ['user', 'seed question', 'the passage'],
      ['assistant', 'seed reply'],
      ['user', 'recent question'],
      ['assistant', 'recent reply'],
    );

    const history = buildPromptHistory(
      { runningSummary: null, summarizedThroughSeq: null },
      messages,
    );

    expect(history.map((m) => m.content)).toEqual([
      expect.stringContaining('seed question'),
      'seed reply',
      'recent question',
      'recent reply',
    ]);
  });

  it('drops the seed entirely if its own turn never completed', () => {
    // A thread whose very first send failed has no seed turn to pin - nothing
    // should be fabricated in its place.
    const messages = rows(
      ['user', 'seed question that failed', 'the passage'],
      ['user', 'retry'],
      ['assistant', 'retry reply'],
    );
    const boundary = messages[0].seq;

    const history = buildPromptHistory(
      { runningSummary: 'summary', summarizedThroughSeq: boundary },
      messages,
    );

    expect(history.map((m) => m.content)).toEqual([
      expect.stringContaining('summary'),
      'retry',
      'retry reply',
    ]);
  });
});
