import { HttpException } from '@nestjs/common';

/**
 * Base class for every domain error that should surface as an RFC 9457
 * Problem. Carries a stable machine-readable `code` the client switches on,
 * alongside the HTTP status and human `title` / `detail`. The single problem
 * filter turns any `ProblemException` into the wire body.
 */
export class ProblemException extends HttpException {
  constructor(
    readonly code: string,
    status: number,
    readonly title: string,
    readonly detail?: string,
  ) {
    super({ code, title, detail }, status);
  }
}

/**
 * A resource that is absent, or owned by another user. Both cases return an
 * identical `404` - the API never discloses that an id exists for someone
 * else, so there is no `403` anywhere.
 */
export class ResourceNotFoundException extends ProblemException {
  constructor(code = 'not_found', detail = 'The resource was not found.') {
    super(code, 404, 'Not found', detail);
  }
}
