// Split a `pageCount` into contiguous, fixed-size, 1-based inclusive page
// ranges. The final range is short when the count is not a multiple of `size`.
// The Gemini adapter sends one request per range and assigns page numbers from
// `start` - the model is never trusted to number its own output.

export interface PageRange {
  // 1-based, inclusive.
  start: number;
  // 1-based, inclusive.
  end: number;
}

export function slicePageRanges(pageCount: number, size: number): PageRange[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(
      `slicePageRanges: pageCount must be a positive integer, got ${pageCount}`,
    );
  }
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(
      `slicePageRanges: size must be a positive integer, got ${size}`,
    );
  }
  const ranges: PageRange[] = [];
  for (let start = 1; start <= pageCount; start += size) {
    ranges.push({ start, end: Math.min(start + size - 1, pageCount) });
  }
  return ranges;
}

// The pages a range covers, expanded to an explicit 1-based list. Used both to
// name the pages a batch must return and to validate the sentinels it did.
export function pagesInRange(range: PageRange): number[] {
  const pages: number[] = [];
  for (let page = range.start; page <= range.end; page++) pages.push(page);
  return pages;
}
