import type { PdfPage } from '@scriptorium/providers';
import { pageRangeMarkdown } from './page-range-markdown.js';

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
