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

  it('folds a wrapped heading tail back into the title', () => {
    const pages = [
      {
        page: 12,
        markdown:
          '# Chapter 5: Identifying Architectural\nCharacteristics\n\n1. First question.',
      },
    ];
    expect(deriveHeadings(pages)).toEqual([
      {
        type: 'heading',
        level: 1,
        text: 'Chapter 5: Identifying Architectural Characteristics',
        page: 12,
      },
    ]);
  });

  it('does not swallow a paragraph that butts against a heading', () => {
    const pages = [
      {
        page: 3,
        markdown:
          '## Summary\nThis chapter covered a great many things in detail.',
      },
    ];
    expect(deriveHeadings(pages)).toEqual([
      { type: 'heading', level: 2, text: 'Summary', page: 3 },
    ]);
  });
});
