import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import {
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPE_PREFIX,
  type ProblemDetail,
  type ProblemDetails,
} from '@scriptorium/contracts';
import { ZodValidationException } from 'nestjs-zod';
import type { HttpRequest, HttpResponse } from './http-types.js';
import { ProblemException } from './problem.exception.js';
import { getRequestId } from './request-context.js';

// Fallback `code` + `title` for a bare `HttpException` that carries no
// `ProblemException` metadata. One table, so a new status is added in one
// place. No `403` - the ownership rule returns `404` for "not yours", so a
// `403` never reaches here.
const STATUS_META: Record<number, { code: string; title: string }> = {
  400: { code: 'bad_request', title: 'Bad request' },
  401: { code: 'unauthorized', title: 'Unauthorized' },
  404: { code: 'not_found', title: 'Not found' },
  422: { code: 'unprocessable_entity', title: 'Unprocessable entity' },
  500: { code: 'internal_error', title: 'Internal server error' },
};
const UNKNOWN_META = { code: 'error', title: 'Error' };

/**
 * The single exception filter. Every non-2xx response leaves here as RFC 9457
 * `application/problem+json` with a stable `code`, the request `X-Request-Id`
 * as `instance`, and - only for `422` schema failures - a flattened `errors`
 * array. Nothing internal is leaked on a `500`.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetailsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<HttpResponse>();
    const req = http.getRequest<HttpRequest>();
    const instance = getRequestId() ?? req.requestId ?? 'unknown';

    const problem = this.toProblem(exception, instance);
    if (problem.status >= 500) {
      this.logger.error(
        `${problem.code} (${instance})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res
      .status(problem.status)
      .type(PROBLEM_CONTENT_TYPE)
      .send(JSON.stringify(problem));
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    if (exception instanceof ZodValidationException) {
      return build(422, 'validation_failed', 'Validation failed', instance, {
        detail: 'The request body failed schema validation.',
        errors: flattenZodIssues(exception),
      });
    }

    if (exception instanceof ProblemException) {
      return build(
        exception.getStatus(),
        exception.code,
        exception.title,
        instance,
        { detail: exception.detail },
      );
    }

    // Malformed JSON body - never a schema failure, always a plain `400`.
    if (isBodyParseError(exception)) {
      return build(400, 'invalid_json', 'Malformed request body', instance, {
        detail: 'The request body is not valid JSON.',
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const { code, title } = STATUS_META[status] ?? UNKNOWN_META;
      return build(status, code, title, instance, {
        // Only echo a detail below 500 - never leak internals.
        detail: status < 500 ? messageOf(exception) : undefined,
      });
    }

    return build(500, 'internal_error', 'Internal server error', instance, {});
  }
}

function build(
  status: number,
  code: string,
  title: string,
  instance: string,
  extra: { detail?: string; errors?: ProblemDetail[] },
): ProblemDetails {
  return {
    type: `${PROBLEM_TYPE_PREFIX}${code.replace(/_/g, '-')}`,
    title,
    status,
    code,
    instance,
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(extra.errors ? { errors: extra.errors } : {}),
  };
}

function flattenZodIssues(exception: ZodValidationException): ProblemDetail[] {
  const { issues } = exception.getZodError() as {
    issues: ReadonlyArray<{
      path: ReadonlyArray<PropertyKey>;
      message: string;
    }>;
  };
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function isBodyParseError(exception: unknown): boolean {
  if (!exception || typeof exception !== 'object') return false;
  const err = exception as { type?: string; status?: number; name?: string };
  if (
    err.type === 'entity.parse.failed' ||
    (err.name === 'SyntaxError' && err.status === 400)
  ) {
    return true;
  }
  // Express 5 + Nest wrap the body-parser failure in a `BadRequestException`
  // whose message names JSON; the original error's fields are gone.
  return (
    exception instanceof HttpException &&
    exception.getStatus() === 400 &&
    /\bJSON\b/i.test(messageOf(exception) ?? '')
  );
}

function messageOf(exception: HttpException): string | undefined {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : undefined;
}
