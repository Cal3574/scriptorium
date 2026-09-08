import type { PdfPage } from '../pdf-extractor.js';

// Each Gemini batch response is plain markdown with an explicit page-break
// sentinel line between pages: `<!-- page N -->`. The parser splits on those
// sentinels and validates that the page numbers it found match - exactly, and
// in order - the range the batch was asked for. A mismatch means the model
// dropped, merged, or reordered a page (it happens on dense pages), which the
// adapter treats as a retryable malformed response.

// A single line that is nothing but a page sentinel. Tolerant of surrounding
// whitespace and a missing/collapsed comment space, strict about the shape.
const SENTINEL = /^[ \t]*<!--[ \t]*page[ \t]+(\d+)[ \t]*-->[ \t]*$/i;

export class SentinelMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SentinelMismatchError';
  }
}

/**
 * Parse a batch response into per-page markdown. `expectedPages` is the 1-based
 * page list the batch covers (see {@link pagesInRange}); the sentinels in the
 * response must reproduce it exactly. Throws {@link SentinelMismatchError}
 * otherwise. Content before the first sentinel is discarded (models sometimes
 * open with a stray blank line or a "Here is the transcription:" preamble).
 */
export function parseSentinelPages(
  response: string,
  expectedPages: number[],
): PdfPage[] {
  const lines = response.split('\n');
  const found: Array<{ page: number; body: string[] }> = [];

  for (const line of lines) {
    const match = SENTINEL.exec(line);
    if (match) {
      found.push({ page: Number(match[1]), body: [] });
    } else if (found.length > 0) {
      found[found.length - 1].body.push(line);
    }
  }

  const foundPages = found.map((p) => p.page);
  if (
    foundPages.length !== expectedPages.length ||
    foundPages.some((page, index) => page !== expectedPages[index])
  ) {
    throw new SentinelMismatchError(
      `expected page sentinels [${expectedPages.join(', ')}] but got [${foundPages.join(', ')}]`,
    );
  }

  return found.map((p) => ({
    page: p.page,
    markdown: p.body.join('\n').trim(),
  }));
}
