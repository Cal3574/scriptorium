import { ProblemException } from '../http/problem.exception.js';

// The cap-exceeded problems. Both are HTTP 402 with a stable machine `code` the
// client switches on; the `detail` is human text for logs and the UI, never
// machine-parsed. The `ProblemDetails` schema is not extended - no structured
// `{ used, limit }` on the body; the client reads those from `GET /me/usage`.

export class BookLimitReachedException extends ProblemException {
  constructor() {
    super(
      'book_limit_reached',
      402,
      'Payment required',
      "You've reached your plan's book limit. Upgrade to Pro for more.",
    );
  }
}

export class QueryLimitReachedException extends ProblemException {
  constructor() {
    super(
      'query_limit_reached',
      402,
      'Payment required',
      "You've reached your plan's monthly question limit. Upgrade to Pro for more.",
    );
  }
}
