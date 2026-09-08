import { classifyGeminiError } from './classify-error.js';
import { SentinelMismatchError } from './parse-sentinel-pages.js';

describe('classifyGeminiError', () => {
  it.each([429, 500, 503, 504])('treats HTTP %i as retryable', (status) => {
    expect(classifyGeminiError({ status })).toBe('retryable');
  });

  it.each([400, 403, 404])('treats HTTP %i as terminal', (status) => {
    expect(classifyGeminiError({ status })).toBe('terminal');
  });

  it('treats an unlisted 4xx as terminal and an unlisted 5xx as retryable', () => {
    expect(classifyGeminiError({ status: 422 })).toBe('terminal');
    expect(classifyGeminiError({ status: 502 })).toBe('retryable');
  });

  it('reads the status from a nested response or a string code', () => {
    expect(classifyGeminiError({ response: { status: 429 } })).toBe(
      'retryable',
    );
    expect(classifyGeminiError({ code: '400' })).toBe('terminal');
  });

  it('treats a malformed/truncated response as retryable', () => {
    expect(classifyGeminiError(new SentinelMismatchError('bad'))).toBe(
      'retryable',
    );
  });

  it('defaults an unrecognised error to retryable', () => {
    expect(classifyGeminiError(new Error('socket hang up'))).toBe('retryable');
    expect(classifyGeminiError('nope')).toBe('retryable');
  });
});
