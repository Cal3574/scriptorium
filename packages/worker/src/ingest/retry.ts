import { errorMessage, isRetryable, retryAfterMs } from './errors.js';

export interface RetryOptions {
  // Total attempts, including the first. The ingest-job spec fixes this at 5
  // for the in-stage retry (one LlamaParse poll, one embedding batch, ...).
  attempts?: number;
  // Base delay for the exponential backoff, in ms.
  baseDelayMs?: number;
  // Cap on any single backoff wait, in ms.
  maxDelayMs?: number;
  // Injected for tests; defaults to a real timer.
  sleep?: (ms: number) => Promise<void>;
  // Called before each wait, for logging/telemetry.
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying a *retryable* failure with exponential backoff. A
 * {@link TerminalIngestError} or a non-retryable provider error is rethrown
 * immediately - there is nothing a retry would fix. A provider `Retry-After`
 * wins over the computed backoff. After the last attempt the final error is
 * rethrown for the job-level retry to catch.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) throw error;

      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = retryAfterMs(error) ?? backoff;
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new Error(`withRetry exhausted: ${errorMessage(lastError)}`);
}
