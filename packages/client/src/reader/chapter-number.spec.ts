import { chapterIndexFromParam } from './chapter-number';

describe('chapterIndexFromParam', () => {
  it('converts a valid 1-based number to a 0-based index', () => {
    expect(chapterIndexFromParam('1', 5)).toBe(0);
    expect(chapterIndexFromParam('5', 5)).toBe(4);
  });

  it('rejects out-of-range, zero, negative, non-integer and missing values', () => {
    expect(chapterIndexFromParam('0', 5)).toBeNull();
    expect(chapterIndexFromParam('6', 5)).toBeNull();
    expect(chapterIndexFromParam('-1', 5)).toBeNull();
    expect(chapterIndexFromParam('1.5', 5)).toBeNull();
    expect(chapterIndexFromParam('two', 5)).toBeNull();
    expect(chapterIndexFromParam(undefined, 5)).toBeNull();
  });
});
