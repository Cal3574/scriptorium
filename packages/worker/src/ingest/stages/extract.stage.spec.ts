import type { BookRow } from '@scriptorium/server-core';
import { extractedMarkdownKey } from './extract.stage.js';

const row = (s3Key: string): BookRow => ({ s3Key }) as BookRow;

describe('extractedMarkdownKey', () => {
  it('swaps a .pdf suffix for .md', () => {
    expect(extractedMarkdownKey(row('books/u/abc.pdf'))).toBe('books/u/abc.md');
    expect(extractedMarkdownKey(row('books/u/abc.PDF'))).toBe('books/u/abc.md');
  });

  it('appends .md rather than colliding with the original when there is no .pdf suffix', () => {
    expect(extractedMarkdownKey(row('books/u/abc'))).toBe('books/u/abc.md');
  });
});
