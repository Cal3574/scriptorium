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
  const { pages, missing } = parseSentinelPagesLenient(response, expectedPages);
  if (missing.length > 0) {
    throw new SentinelMismatchError(
      `expected page sentinels [${expectedPages.join(', ')}] but got [${pages
        .map((p) => p.page)
        .join(', ')}]`,
    );
  }
  return pages;
}

/**
 * Like {@link parseSentinelPages}, but tolerates a response that dropped one or
 * more pages: as long as the sentinels it *did* emit are a subset of
 * `expectedPages` in the right order (no extras, no reordering), the parsed
 * pages are returned alongside `missing` - the expected pages with no sentinel.
 * The adapter salvages those one at a time rather than failing the whole book.
 * A genuinely scrambled response (an extra or out-of-order sentinel) still
 * throws {@link SentinelMismatchError}.
 */
export function parseSentinelPagesLenient(
  response: string,
  expectedPages: number[],
): { pages: PdfPage[]; missing: number[] } {
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

  const expected = new Set(expectedPages);
  let cursor = 0;
  for (const { page } of found) {
    // Every sentinel must be an expected page, and they must appear in the same
    // order as `expectedPages` - advance a cursor through it, allowing gaps.
    if (!expected.has(page)) {
      throw new SentinelMismatchError(
        `unexpected page sentinel ${page} (expected a subset of [${expectedPages.join(', ')}])`,
      );
    }
    const next = expectedPages.indexOf(page, cursor);
    if (next === -1) {
      throw new SentinelMismatchError(
        `page sentinel ${page} is out of order (expected [${expectedPages.join(', ')}])`,
      );
    }
    cursor = next + 1;
  }

  const foundPages = new Set(found.map((p) => p.page));
  return {
    pages: found.map((p) => ({
      page: p.page,
      markdown: p.body.join('\n').trim(),
    })),
    missing: expectedPages.filter((page) => !foundPages.has(page)),
  };
}
