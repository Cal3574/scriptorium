import { ProblemException } from '@scriptorium/server-core';

// The two query-endpoint domain errors that surface before the SSE stream
// opens, each with the stable `code` the client switches on.

export class QuestionTooLongException extends ProblemException {
  constructor(max: number) {
    super(
      'question_too_long',
      422,
      'Question too long',
      `A question must be between 1 and ${max} characters.`,
    );
  }
}

export class QuestionEmbeddingFailedException extends ProblemException {
  constructor() {
    super(
      'upstream_failure',
      502,
      'Upstream failure',
      'The question could not be embedded. Try again in a moment.',
    );
  }
}
