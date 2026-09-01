import { PdfExtractionError } from '@scriptorium/providers';
import { TerminalIngestError } from './errors.js';
import { withRetry } from './retry.js';

describe('withRetry', () => {
  const noSleep = jest.fn<Promise<void>, [number]>(() => Promise.resolve());
  beforeEach(() => noSleep.mockClear());

  it('returns on the first success without sleeping', async () => {
    const result = await withRetry(() => Promise.resolve('ok'), {
      sleep: noSleep,
    });
    expect(result).toBe('ok');
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('retries a retryable failure then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) return Promise.reject(new Error('transient'));
        return Promise.resolve('recovered');
      },
      { sleep: noSleep, baseDelayMs: 10 },
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
    expect(noSleep).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenNthCalledWith(1, 10);
    expect(noSleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('rethrows a TerminalIngestError immediately, no retry', async () => {
    const fn = jest.fn(() =>
      Promise.reject(new TerminalIngestError('broken')),
    );
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow('broken');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it('rethrows a non-retryable provider error immediately', async () => {
    const fn = jest.fn(() =>
      Promise.reject(new PdfExtractionError('PDF_IS_PROTECTED', false)),
    );
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toThrow(
      'PDF_IS_PROTECTED',
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after `attempts` and rethrows the last error', async () => {
    const fn = jest.fn(() => Promise.reject(new Error('always')));
    await expect(
      withRetry(fn, { attempts: 4, sleep: noSleep, baseDelayMs: 1 }),
    ).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(4);
    expect(noSleep).toHaveBeenCalledTimes(3);
  });

  it('honours a Retry-After over the computed backoff', async () => {
    let first = true;
    await withRetry(
      () => {
        if (first) {
          first = false;
          return Promise.reject(Object.assign(new Error('429'), { retryAfter: 5 }));
        }
        return Promise.resolve('ok');
      },
      { sleep: noSleep, baseDelayMs: 1_000 },
    );
    expect(noSleep).toHaveBeenCalledWith(5_000);
  });
});
