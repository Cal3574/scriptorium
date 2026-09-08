import { SentinelMismatchError } from './parse-sentinel-pages.js';

// Map a thrown value from a Gemini batch call to one of two outcomes:
//   - `retryable`: the same request might succeed if repeated - HTTP 429, 500,
//     503, 504, a network blip, or a malformed/truncated response (wrong
//     sentinel count or order).
//   - `terminal`: the request is broken and will not fix itself - HTTP 400,
//     403, 404 (bad request, bad key, wrong model id).
// A safety block is handled separately by the adapter (page-by-page salvage),
// never routed through here.

export type GeminiErrorClass = 'retryable' | 'terminal';

const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
const TERMINAL_STATUS = new Set([400, 403, 404]);

function readStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;
  for (const value of [
    record.status,
    record.code,
    (record.response as Record<string, unknown> | undefined)?.status,
  ]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value))
      return Number(value);
  }
  return undefined;
}

export function classifyGeminiError(error: unknown): GeminiErrorClass {
  // A response that parsed but did not carry the pages we asked for: retry the
  // batch, the model often gets it right on a second pass.
  if (error instanceof SentinelMismatchError) return 'retryable';

  const status = readStatus(error);
  if (status !== undefined) {
    if (TERMINAL_STATUS.has(status)) return 'terminal';
    if (RETRYABLE_STATUS.has(status)) return 'retryable';
    // Any other explicit 4xx is our fault and terminal; other 5xx are transient.
    if (status >= 400 && status < 500) return 'terminal';
    if (status >= 500) return 'retryable';
  }

  // No status to key off (a raw network error, an SDK bug): retry, matching the
  // ingest pipeline's "unknown errors are retryable" default.
  return 'retryable';
}
