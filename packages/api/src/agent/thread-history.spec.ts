import type { AgentMessageRow } from '@scriptorium/server-core';
import { reassembleHistory } from './thread-history';

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
