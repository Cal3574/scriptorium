import { pagesInRange, slicePageRanges } from './slice-page-ranges.js';

describe('slicePageRanges', () => {
  it('splits an exact multiple into equal ranges', () => {
    expect(slicePageRanges(20, 10)).toEqual([
      { start: 1, end: 10 },
      { start: 11, end: 20 },
    ]);
  });

  it('makes the final range short when the count is not a multiple', () => {
    expect(slicePageRanges(25, 10)).toEqual([
      { start: 1, end: 10 },
      { start: 11, end: 20 },
      { start: 21, end: 25 },
    ]);
  });

  it('returns a single range when the book is shorter than one batch', () => {
    expect(slicePageRanges(3, 10)).toEqual([{ start: 1, end: 3 }]);
  });

  it('handles a one-page book', () => {
    expect(slicePageRanges(1, 10)).toEqual([{ start: 1, end: 1 }]);
  });

  it('rejects a non-positive page count or size', () => {
    expect(() => slicePageRanges(0, 10)).toThrow(/pageCount/);
    expect(() => slicePageRanges(10, 0)).toThrow(/size/);
  });
});

describe('pagesInRange', () => {
  it('expands a range to an inclusive 1-based list', () => {
    expect(pagesInRange({ start: 11, end: 14 })).toEqual([11, 12, 13, 14]);
    expect(pagesInRange({ start: 7, end: 7 })).toEqual([7]);
  });
});
