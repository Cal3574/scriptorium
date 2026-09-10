import type { PdfPage } from '../pdf-extractor.js';

// Each Gemini batch response is plain markdown with an explicit page-break
// sentinel line between pages: `<!-- page K -->`. K is the page's position
// *within the slice the batch was sent* - 1 for the first page, counting up -
// never the book's absolute page number and never the folio printed on the
// page. The slice is a standalone PDF cut out of the book, so the model has no
// way to know its absolute position; asking it to echo absolute numbers made
// it transcribe the printed folio instead (an extract of pages 161-170 whose
// pages are printed "153"..."162" would emit `<!-- page 153 -->`), which the
// strict parser then rejected outright and failed the whole book.
//
// The parser splits on the sentinels, checks they are the slice-local
// sequence 1, 2, 3, ... in order, and maps each back to an absolute page
// number by position. A gap in the sequence means the model dropped that page;
// an out-of-range or out-of-order sentinel means the response is scrambled and
// is treated as a retryable malformed response.

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
 * absolute page list the batch covers (see {@link pagesInRange}); the response
 * must carry a sentinel for every one of them - the slice-local sequence
 * `1..expectedPages.length`, in order. Throws {@link SentinelMismatchError}
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
      `expected sentinels for all ${expectedPages.length} page(s) of the ` +
        `slice but pages [${missing.join(', ')}] were not emitted`,
    );
  }
  return pages;
}

/**
 * Like {@link parseSentinelPages}, but tolerates a response that dropped one or
 * more pages: as long as the sentinels it *did* emit are a subsequence of
 * `1..expectedPages.length` in ascending order (no extras, no repeats, no
 * reordering), the parsed pages are returned - mapped to their absolute page
 * numbers - alongside `missing`, the absolute pages whose slice-local sentinel
 * never appeared. The adapter salvages those one at a time rather than failing
 * the whole book. A genuinely scrambled response (a sentinel outside
 * `1..length`, or one that goes backwards) still throws
 * {@link SentinelMismatchError}.
 */
export function parseSentinelPagesLenient(
  response: string,
  expectedPages: number[],
): { pages: PdfPage[]; missing: number[] } {
  const count = expectedPages.length;
  const lines = response.split('\n');
  const found: Array<{ position: number; body: string[] }> = [];

  for (const line of lines) {
    const match = SENTINEL.exec(line);
    if (match) {
      found.push({ position: Number(match[1]), body: [] });
    } else if (found.length > 0) {
      found[found.length - 1].body.push(line);
    }
  }

  let previous = 0;
  for (const { position } of found) {
    // Sentinels are slice-local 1-based positions. Anything outside the slice's
    // page count, or a position that does not advance, is a scrambled response.
    if (position < 1 || position > count) {
      throw new SentinelMismatchError(
        `unexpected page sentinel ${position} (the slice covers ${count} ` +
          `page(s), so sentinels must be 1..${count})`,
      );
    }
    if (position <= previous) {
      throw new SentinelMismatchError(
        `page sentinel ${position} is out of order (expected the ascending ` +
          `sequence 1..${count})`,
      );
    }
    previous = position;
  }

  const seen = new Set(found.map((p) => p.position));
  return {
    pages: found.map((p) => ({
      page: expectedPages[p.position - 1],
      markdown: p.body.join('\n').trim(),
    })),
    missing: expectedPages.filter((_page, index) => !seen.has(index + 1)),
  };
}
