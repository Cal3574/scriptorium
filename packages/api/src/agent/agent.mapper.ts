// Maps `AgentRepository` rows to the wire DTOs behind `GET .../agent-thread`.

import { AgentMessageDto, AgentThreadDto } from '@scriptorium/contracts';
import type { AgentMessageRow, AgentThreadRow } from '@scriptorium/server-core';

// One turn-half, as returned in `AgentThreadDto.messages`.
export function toAgentMessageDto(row: AgentMessageRow): AgentMessageDto {
  return AgentMessageDto.parse({
    id: row.id,
    role: row.role,
    message: row.message,
    highlightedPassage: row.highlightedPassage,
    createdAt: row.createdAt.toISOString(),
  });
}

// The whole thread in one shape, oldest message first. Failed turns are not
// filtered out here - the client renders an unanswered user message as such;
// only the prompt-side `reassembleHistory` drops them.
export function toAgentThreadDto(
  thread: AgentThreadRow,
  messages: AgentMessageRow[],
): AgentThreadDto {
  return AgentThreadDto.parse({
    id: thread.id,
    bookId: thread.bookId,
    createdAt: thread.createdAt.toISOString(),
    messages: messages.map(toAgentMessageDto),
  });
}
