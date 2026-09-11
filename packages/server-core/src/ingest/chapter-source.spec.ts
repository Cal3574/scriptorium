import type { PdfPage } from '@scriptorium/providers';
import type { ExtractionArtifact } from './extraction-artifact.js';
import {
  CHAPTER_SOURCE_MAX_BYTES,
  buildChapterSource,
} from './chapter-source.js';

function artifact(pages: PdfPage[]): ExtractionArtifact {
  return {
    pages,
    items: [],
    outline: [],
    metadata: { title: null, author: null },
    pageCount: pages.length,
  };
}

const para = (n: number) =>
  `Paragraph ${n}. It carries a few sentences of ordinary prose so the ` +
  `stitched chapter text has real structure to slice on.`;

describe('buildChapterSource', () => {
  it('stitches the inclusive page range into GFM markdown', () => {
    const art = artifact([
      { page: 1, markdown: '# Front matter' },
      { page: 2, markdown: '## Chapter 1\n\nOpening line.' },
      { page: 3, markdown: 'Second page of the chapter.' },
      { page: 4, markdown: 'Next chapter starts here.' },
    ]);

    const result = buildChapterSource(art, { pageStart: 2, pageEnd: 3 });

    expect(result).toEqual({
      available: true,
      truncated: false,
      text: '## Chapter 1\n\nOpening line.\n\nSecond page of the chapter.',
    });
  });

  it('is unavailable when the page range holds only whitespace', () => {
    const art = artifact([
      { page: 1, markdown: 'real text' },
      { page: 2, markdown: '   \n\n  ' },
      { page: 3, markdown: '' },
    ]);

    expect(buildChapterSource(art, { pageStart: 2, pageEnd: 3 })).toEqual({
      available: false,
      text: null,
      truncated: false,
    });
  });

  it('is unavailable when the extraction artifact is missing', () => {
    expect(buildChapterSource(null, { pageStart: 1, pageEnd: 9 })).toEqual({
      available: false,
      text: null,
      truncated: false,
    });
  });

  it('falls back to page 1 / pageCount when the range is null', () => {
    const art = artifact([
      { page: 1, markdown: 'first' },
      { page: 2, markdown: 'second' },
    ]);

    expect(
      buildChapterSource(art, { pageStart: null, pageEnd: null }).text,
    ).toBe('first\n\nsecond');
  });

  it('leaves text under the ceiling untouched', () => {
    const art = artifact([{ page: 1, markdown: `${para(1)}\n\n${para(2)}` }]);

    const result = buildChapterSource(art, { pageStart: 1, pageEnd: 1 });

    expect(result.truncated).toBe(false);
    expect(result.text).toBe(`${para(1)}\n\n${para(2)}`);
  });

  it('truncates on a paragraph boundary and flags it when over the ceiling', () => {
    const big = Array.from({ length: 40 }, (_, i) => para(i + 1)).join('\n\n');
    const art = artifact([{ page: 1, markdown: big }]);
    const maxBytes = Buffer.byteLength(para(1)) * 5 + 20;

    const result = buildChapterSource(
      art,
      { pageStart: 1, pageEnd: 1 },
      maxBytes,
    );

    expect(result.available).toBe(true);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text ?? '')).toBeLessThanOrEqual(maxBytes);
    // Cut on a boundary: every kept paragraph is whole.
    for (const chunk of (result.text ?? '').split('\n\n')) {
      expect(big.split('\n\n')).toContain(chunk);
    }
    expect(big.startsWith(result.text ?? '')).toBe(true);
  });

  it('hard-caps a single paragraph that alone exceeds the ceiling', () => {
    const oneHugePara = 'x'.repeat(5_000);
    const art = artifact([{ page: 1, markdown: oneHugePara }]);

    const result = buildChapterSource(art, { pageStart: 1, pageEnd: 1 }, 1_000);

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text ?? '')).toBeLessThanOrEqual(1_000);
    expect(result.text?.length).toBeGreaterThan(0);
  });

  it('exposes a 200 KB default ceiling', () => {
    expect(CHAPTER_SOURCE_MAX_BYTES).toBe(200 * 1024);
  });
});
