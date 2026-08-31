import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { HttpRequest, HttpResponse } from './http-types.js';
import { runWithRequestContext } from './request-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Assigns each request an `X-Request-Id` (uuid v4), or reuses the
 * client-supplied one. The id is echoed on the response header and bound to
 * the async-local request context, from which the request-aware logger and
 * the problem filter read it.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: HttpRequest, res: HttpResponse, next: () => void): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId = isUuid(incoming) ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    runWithRequestContext({ requestId }, next);
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
