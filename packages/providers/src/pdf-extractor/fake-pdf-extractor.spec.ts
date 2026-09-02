import { FakePdfExtractor } from './fake-pdf-extractor.js';

const input = { data: new Uint8Array([1, 2, 3]), filename: 'ignored.pdf' };

describe('FakePdfExtractor', () => {
  const extractor = new FakePdfExtractor();

  it('returns committed markdown with a single `#` book title and `##` chapters', async () => {
    const { markdown } = await extractor.extract(input);
    const h1 = markdown.match(/^# .+/gm) ?? [];
    const h2 = markdown.match(/^## .+/gm) ?? [];
    expect(h1).toHaveLength(1);
    expect(h2.length).toBeGreaterThanOrEqual(6);
  });

  it('synthesises heading `items` consistent with the markdown headings', async () => {
    const { markdown, items } = await extractor.extract(input);
    const headingLines = (markdown.match(/^#{1,6} .+/gm) ?? []).map((l) =>
      l.replace(/^#{1,6}\s+/, ''),
    );
    expect(items.map((i) => i.text)).toEqual(headingLines);
    expect(items.every((i) => i.type === 'heading')).toBe(true);
  });

  it('gives heading items monotonically increasing page numbers', async () => {
    const { items, pageCount } = await extractor.extract(input);
    const pages = items.map((i) => i.page);
    expect([...pages]).toEqual([...pages].sort((a, b) => a - b));
    expect(pages[0]).toBe(1);
    expect(pageCount).toBeGreaterThanOrEqual(pages[pages.length - 1]);
  });

  it('has at least one `chapter N` heading for the detector to key off', async () => {
    const { items } = await extractor.extract(input);
    expect(items.some((i) => /^chapter\s+\d+/i.test(i.text))).toBe(true);
  });

  it('returns one per-page markdown slice per page, in order', async () => {
    const { pages, pageCount } = await extractor.extract(input);
    expect(pages).toHaveLength(pageCount);
    expect(pages.map((p) => p.page)).toEqual(
      Array.from({ length: pageCount }, (_, i) => i + 1),
    );
    expect(pages.map((p) => p.markdown).join('\n')).toContain('## Chapter 1');
  });

  it('synthesises a flat bookmark outline over the `##` chapter headings', async () => {
    const { outline, items } = await extractor.extract(input);
    const h2 = items.filter((i) => i.level === 2);
    expect(outline).toHaveLength(h2.length);
    expect(outline[0]).toMatchObject({ title: h2[0].text, page: h2[0].page });
    expect(outline.every((n) => n.children.length === 0)).toBe(true);
  });

  it('reports the PDF title from the `#` heading', async () => {
    const { metadata } = await extractor.extract(input);
    expect(metadata.title).toMatch(/\S/);
    expect(metadata.author).toBeNull();
  });

  it('ignores the input bytes', async () => {
    const a = await extractor.extract(input);
    const b = await extractor.extract({
      data: new Uint8Array(),
      filename: 'x.pdf',
    });
    expect(a).toEqual(b);
  });
});
