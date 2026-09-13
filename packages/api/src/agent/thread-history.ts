import type { LlmMessage } from '@scriptorium/providers';
import type { AgentMessageRow, AgentThreadRow } from '@scriptorium/server-core';
import { buildAgentUserMessage } from './agent-prompt.js';

// One completed exchange: exactly a user row immediately followed by its
// assistant reply.
export type CompletedTurn = readonly [
  user: AgentMessageRow,
  assistant: AgentMessageRow,
];

/**
 * Groups the persisted rows of a thread into completed turns, dropping
 * anything that is not one.
 *
 * Failure is encoded in the rows themselves rather than a status column, so
 * this is where it gets read back: a turn counts only when a user row is
 * immediately followed by an assistant row. A user row with nothing after it
 * (or with another user row after it) is a turn whose generation failed - the
 * reader still sees it in the transcript as unanswered, but replaying half a
 * turn to the model would teach it that questions go unanswered, so it is
 * dropped here. An assistant row with no user row before it cannot happen
 * through the endpoint, and is dropped for the same reason.
 *
 * Shared by {@link reassembleHistory} (turns -> prompt messages) and the
 * context-window trimmer (turns -> what to fold into the rolling summary),
 * so both agree on exactly the same definition of "a turn".
 */
export function groupCompletedTurns(
  messages: AgentMessageRow[],
): CompletedTurn[] {
  const turns: CompletedTurn[] = [];

  for (let i = 0; i < messages.length; i++) {
    const current = messages[i];
    if (current.role !== 'user') continue;

    const reply = messages[i + 1];
    if (reply?.role !== 'assistant') continue;

    turns.push([current, reply]);
    i++;
  }

  return turns;
}

/**
 * Turn the persisted rows of a thread into the message list replayed to the
 * model. See {@link groupCompletedTurns} for which rows survive.
 */
export function reassembleHistory(messages: AgentMessageRow[]): LlmMessage[] {
  return groupCompletedTurns(messages).flatMap(([user, assistant]) => [
    {
      role: 'user' as const,
      content: buildAgentUserMessage(user.message, user.highlightedPassage),
    },
    { role: 'assistant' as const, content: assistant.message },
  ]);
}

/**
 * The context-window-aware form of {@link reassembleHistory}: folds
 * `thread.runningSummary` in ahead of the verbatim tail, and always keeps the
 * thread's opening turn (the highlight-to-discuss seed) verbatim even once it
 * ages out of the summarized region - the companion's opening framing depends
 * on it specifically, not on a paraphrase (#158).
 *
 * Below the trim threshold `runningSummary` and `summarizedThroughSeq` are
 * both null, every message is "verbatim", and this behaves exactly like
 * {@link reassembleHistory}.
 */
export function buildPromptHistory(
  thread: Pick<AgentThreadRow, 'runningSummary' | 'summarizedThroughSeq'>,
  messages: AgentMessageRow[],
): LlmMessage[] {
  if (messages.length === 0) return [];

  const boundary = thread.summarizedThroughSeq;
  const verbatim =
    boundary !== null ? messages.filter((m) => m.seq > boundary) : messages;

  const history: LlmMessage[] = [];

  if (thread.runningSummary) {
    history.push({
      role: 'user',
      content: `[Summary of earlier turns in this conversation: ${thread.runningSummary}]`,
    });
  }

  const [seedTurn] = groupCompletedTurns(messages.slice(0, 2));
  if (seedTurn && !verbatim.includes(seedTurn[0])) {
    history.push(
      {
        role: 'user',
        content: buildAgentUserMessage(
          seedTurn[0].message,
          seedTurn[0].highlightedPassage,
        ),
      },
      { role: 'assistant', content: seedTurn[1].message },
    );
  }

  history.push(...reassembleHistory(verbatim));

  return history;
}
