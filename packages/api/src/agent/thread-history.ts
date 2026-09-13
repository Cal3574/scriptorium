import type { LlmMessage } from '@scriptorium/providers';
import type { AgentMessageRow } from '@scriptorium/server-core';
import { buildAgentUserMessage } from './agent-prompt.js';

/**
 * Turn the persisted rows of a thread into the message list replayed to the
 * model.
 *
 * Failure is encoded in the rows themselves rather than a status column, so
 * this is where it gets read back: a turn counts only when a user row is
 * immediately followed by an assistant row. A user row with nothing after it
 * (or with another user row after it) is a turn whose generation failed - the
 * reader still sees it in the transcript as unanswered, but replaying half a
 * turn to the model would teach it that questions go unanswered, so it is
 * dropped here. An assistant row with no user row before it cannot happen
 * through the endpoint, and is dropped for the same reason.
 */
export function reassembleHistory(messages: AgentMessageRow[]): LlmMessage[] {
  const history: LlmMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const current = messages[i];
    if (current.role !== 'user') continue;

    const reply = messages[i + 1];
    if (reply?.role !== 'assistant') continue;

    history.push({
      role: 'user',
      content: buildAgentUserMessage(
        current.message,
        current.highlightedPassage,
      ),
    });
    history.push({ role: 'assistant', content: reply.message });
    i++;
  }

  return history;
}
