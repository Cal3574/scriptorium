import { deriveHeadings } from './derive-headings.js';

describe('deriveHeadings', () => {
  it('pulls ATX headings from each page with its page number', () => {
    const pages = [
      { page: 4, markdown: '# The Book Title\n\nFront matter.' },
      { page: 5, markdown: '## Chapter 1. Beginnings\n\nText.\n### A note' },
      { page: 6, markdown: 'No heading here.' },
    ];

    expect(deriveHeadings(pages)).toEqual([
      { type: 'heading', level: 1, text: 'The Book Title', page: 4 },
      { type: 'heading', level: 2, text: 'Chapter 1. Beginnings', page: 5 },
      { type: 'heading', level: 3, text: 'A note', page: 5 },
    ]);
  });

  it('ignores a bare hash with no text and trims trailing spaces', () => {
    const pages = [{ page: 1, markdown: '#\n##   Spaced Title   ' }];
    expect(deriveHeadings(pages)).toEqual([
      { type: 'heading', level: 2, text: 'Spaced Title', page: 1 },
    ]);
  });

  it('returns nothing for a book with no headings', () => {
    expect(deriveHeadings([{ page: 1, markdown: 'Just prose.' }])).toEqual([]);
  });
});
