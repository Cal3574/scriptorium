import { auditCitations } from './citation-parser.js';

describe('auditCitations', () => {
  it('extracts distinct in-range markers, ascending', () => {
    const answer = 'A claim [3], another [1][3], and a third [2].';
    expect(auditCitations(answer, 5)).toEqual({
      cited: [1, 2, 3],
      dropped: [],
    });
  });

  it('returns nothing for an answer with no markers', () => {
    expect(
      auditCitations('The library does not seem to cover this.', 4),
    ).toEqual({
      cited: [],
      dropped: [],
    });
  });

  it('drops markers outside 1..k', () => {
    const answer = 'In range [2], out of range [9] and [12].';
    expect(auditCitations(answer, 4)).toEqual({ cited: [2], dropped: [9, 12] });
  });

  it('ignores marker 0 and three-digit numbers', () => {
    const answer = 'Zero [0], long [123], real [1].';
    expect(auditCitations(answer, 4)).toEqual({ cited: [1], dropped: [0] });
  });

  it('does not match bracketed non-numeric or spaced text', () => {
    const answer = 'A footnote [note] and [ 1 ] and a range [1-2].';
    expect(auditCitations(answer, 4)).toEqual({ cited: [], dropped: [] });
  });

  it('handles adjacent and repeated markers', () => {
    const answer = '[1][1][2][2][2] all agree.';
    expect(auditCitations(answer, 2)).toEqual({ cited: [1, 2], dropped: [] });
  });
});
