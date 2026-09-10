import type { PdfPage } from '@scriptorium/providers';
import {
  chapterPageRangeMarkdown,
  pageRangeMarkdown,
} from './page-range-markdown.js';

const pages: PdfPage[] = [
  { page: 3, markdown: 'three' },
  { page: 1, markdown: 'one' },
  { page: 2, markdown: 'two' },
  { page: 4, markdown: 'four' },
];

describe('pageRangeMarkdown', () => {
  it('joins the inclusive range in page order', () => {
    expect(pageRangeMarkdown(pages, 2, 3)).toBe('two\n\nthree');
  });

  it('returns an empty string when no page falls in range', () => {
    expect(pageRangeMarkdown(pages, 10, 12)).toBe('');
  });
});

describe('chapterPageRangeMarkdown', () => {
  const artifact = { pages, pageCount: 4 };

  it('slices the chapter bounds when both are set', () => {
    expect(
      chapterPageRangeMarkdown(artifact, { pageStart: 2, pageEnd: 3 }),
    ).toBe('two\n\nthree');
  });

  it('falls back to page 1 and pageCount when the bounds are null', () => {
    expect(
      chapterPageRangeMarkdown(artifact, { pageStart: null, pageEnd: null }),
    ).toBe('one\n\ntwo\n\nthree\n\nfour');
  });
});
