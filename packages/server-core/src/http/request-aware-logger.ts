import { ConsoleLogger } from '@nestjs/common';
import { getRequestId } from './request-context.js';

/**
 * The application logger. Identical to Nest's `ConsoleLogger` except every
 * line emitted while a request is in flight is prefixed with that request's
 * `X-Request-Id`, so one id ties the access log, any handler logs, and the
 * problem-filter's `500` entry together. Register with `app.useLogger(new
 * RequestAwareLogger())`.
 */
export class RequestAwareLogger extends ConsoleLogger {
  override log(message: unknown, ...rest: unknown[]): void {
    super.log(this.tag(message), ...rest);
  }

  override error(message: unknown, ...rest: unknown[]): void {
    super.error(this.tag(message), ...rest);
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    super.warn(this.tag(message), ...rest);
  }

  override debug(message: unknown, ...rest: unknown[]): void {
    super.debug(this.tag(message), ...rest);
  }

  override verbose(message: unknown, ...rest: unknown[]): void {
    super.verbose(this.tag(message), ...rest);
  }

  private tag(message: unknown): unknown {
    const requestId = getRequestId();
    return requestId && typeof message === 'string'
      ? `[req ${requestId}] ${message}`
      : message;
  }
}
