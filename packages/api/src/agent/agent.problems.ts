import { ProblemException } from '@scriptorium/server-core';

// Agent-endpoint domain errors that surface before the SSE stream opens, each
// with the stable `code` the client switches on. Anything that goes wrong
// *after* headers are flushed is an `agent_error` event instead.

export class AgentMessageTooLongException extends ProblemException {
  constructor(max: number) {
    super(
      'agent_message_too_long',
      422,
      'Message too long',
      `A message must be between 1 and ${max} characters.`,
    );
  }
}

export class HighlightedPassageTooLongException extends ProblemException {
  constructor(max: number) {
    super(
      'highlighted_passage_too_long',
      422,
      'Highlighted passage too long',
      `A highlighted passage must be at most ${max} characters.`,
    );
  }
}
