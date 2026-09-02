import { PdfExtractionError } from '@scriptorium/providers';
import { isRetryable, retryAfterMs, TerminalIngestError } from './errors.js';

describe('isRetryable', () => {
  it('is false for a TerminalIngestError', () => {
    expect(isRetryable(new TerminalIngestError('x'))).toBe(false);
  });

  it('follows the PdfExtractionError flag', () => {
    expect(isRetryable(new PdfExtractionError('rate limited', true))).toBe(
      true,
    );
    expect(isRetryable(new PdfExtractionError('broken', false))).toBe(false);
  });

  it('defaults an unknown error to retryable', () => {
    expect(isRetryable(new Error('who knows'))).toBe(true);
    expect(isRetryable('a string')).toBe(true);
  });
});

describe('retryAfterMs', () => {
  it('reads a numeric `retryAfter` as seconds', () => {
    expect(retryAfterMs(Object.assign(new Error(), { retryAfter: 3 }))).toBe(
      3_000,
    );
  });

  it('reads `retryAfterMs` as milliseconds', () => {
    expect(
      retryAfterMs(Object.assign(new Error(), { retryAfterMs: 1_500 })),
    ).toBe(1_500);
  });

  it('reads a `retry-after` header off a headers bag', () => {
    expect(
      retryAfterMs(
        Object.assign(new Error(), { headers: { 'retry-after': '7' } }),
      ),
    ).toBe(7_000);
  });

  it('returns null when there is nothing to read', () => {
    expect(retryAfterMs(new Error('plain'))).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
  });

  it('treats an empty / whitespace header as absent, not zero', () => {
    expect(
      retryAfterMs(
        Object.assign(new Error(), { headers: { 'retry-after': '' } }),
      ),
    ).toBeNull();
    expect(
      retryAfterMs(Object.assign(new Error(), { retryAfter: '   ' })),
    ).toBeNull();
  });
});
