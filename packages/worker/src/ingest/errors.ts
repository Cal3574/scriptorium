import { PdfExtractionError } from '@scriptorium/providers';

/**
 * A failure the pipeline cannot recover from by retrying: a broken or
 * password-protected PDF, a non-429 4xx, an auth failure, a genuine bug, or a
 * structurally impossible result. The processor marks the book `failed` and
 * throws BullMQ's `UnrecoverableError` so the job is not retried.
 */
export class TerminalIngestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TerminalIngestError';
  }
}

/**
 * Classify an arbitrary thrown value. Anything explicitly terminal
 * ({@link TerminalIngestError}, a non-retryable {@link PdfExtractionError})
 * short-circuits to `failed`; everything else - 429, 5xx, timeout, network,
 * an unrecognised error - is treated as retryable, which is the safe default
 * for a job that BullMQ will re-run.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof TerminalIngestError) return false;
  if (error instanceof PdfExtractionError) return error.retryable;
  return true;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * The `Retry-After` a provider asked us to wait, in milliseconds, or `null`.
 * Recognises both a numeric seconds value and an HTTP-date on a `retryAfter` /
 * `retry-after` property or header bag hung off the error.
 */
export function retryAfterMs(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;

  const record = error as Record<string, unknown>;
  const raw =
    record.retryAfterMs ??
    record.retryAfter ??
    readHeader(record.headers) ??
    readHeader(
      (record.response as Record<string, unknown> | undefined)?.headers,
    );

  if (raw == null) return null;
  if (typeof raw === 'number') {
    // `retryAfterMs` is already ms; a bare `retryAfter` is seconds.
    return record.retryAfterMs != null ? raw : raw * 1000;
  }
  const text = String(raw).trim();
  if (text === '') return null;
  const asNumber = Number(text);
  if (!Number.isNaN(asNumber)) return asNumber * 1000;
  const asDate = Date.parse(text);
  return Number.isNaN(asDate) ? null : Math.max(0, asDate - Date.now());
}

function readHeader(headers: unknown): unknown {
  if (typeof headers !== 'object' || headers === null) return undefined;
  if (headers instanceof Map) return headers.get('retry-after');
  const record = headers as Record<string, unknown>;
  if (typeof record.get === 'function') {
    return (record.get as (k: string) => unknown)('retry-after');
  }
  return record['retry-after'] ?? record['Retry-After'];
}
