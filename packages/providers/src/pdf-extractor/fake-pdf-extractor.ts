import type {
  PdfExtractInput,
  PdfExtraction,
  PdfExtractor,
  PdfHeadingItem,
  PdfOutlineItem,
  PdfPage,
} from './pdf-extractor.js';
import { SAMPLE_BOOK_MARKDOWN } from './fixtures/sample-book.js';

// Roughly how many markdown characters map to one printed page. Only used to
// synthesise plausible, monotonically increasing `page` numbers for the
// heading blocks and to split the markdown into per-page slices so chapter
// detection has consecutive pages to turn into ranges. The exact value does
// not matter; consistency across a run does.
const CHARS_PER_PAGE = 900;

// The committed fixture, inlined as a string module (see `sample-book.ts`).
const FIXTURE_MARKDOWN = SAMPLE_BOOK_MARKDOWN;

function pageForOffset(offset: number): number {
  return Math.floor(offset / CHARS_PER_PAGE) + 1;
}

function parseHeadings(markdown: string): PdfHeadingItem[] {
  const items: PdfHeadingItem[] = [];
  let offset = 0;
  for (const line of markdown.split('\n')) {
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (match) {
      items.push({
        type: 'heading',
        level: match[1].length,
        text: match[2],
        page: pageForOffset(offset),
      });
    }
    offset += line.length + 1;
  }
  return items;
}

// Split the markdown into per-page slices on line boundaries, so each page's
// text is whole lines and every `##` heading lands on the same page the
// matching `items` entry reports.
function splitPages(markdown: string, pageCount: number): PdfPage[] {
  const buckets = new Map<number, string[]>();
  let offset = 0;
  for (const line of markdown.split('\n')) {
    const page = pageForOffset(offset);
    const bucket = buckets.get(page) ?? [];
    bucket.push(line);
    buckets.set(page, bucket);
    offset += line.length + 1;
  }
  const pages: PdfPage[] = [];
  for (let page = 1; page <= pageCount; page++) {
    pages.push({ page, markdown: (buckets.get(page) ?? []).join('\n') });
  }
  return pages;
}

// A flat, single-level bookmark outline from the `##` chapter headings, each
// pointing at the page its `items` entry reports. Mirrors the shape a real
// PDF's table-of-contents bookmarks take.
function synthesiseOutline(items: PdfHeadingItem[]): PdfOutlineItem[] {
  return items
    .filter((item) => item.level === 2)
    .map((item) => ({ title: item.text, page: item.page, children: [] }));
}

/**
 * Offline {@link PdfExtractor}. Ignores the input bytes and returns a committed
 * book with real `#`/`##` headings, per-page markdown, `items` heading blocks
 * whose pages are synthesised from the headings' position in the markdown, and
 * a flat bookmark outline over the chapter headings - so the whole ingest
 * pipeline (extract, chapter detection, chunking, summarising) runs with zero
 * cost and no network.
 */
export class FakePdfExtractor implements PdfExtractor {
  private readonly markdown: string;
  private readonly items: PdfHeadingItem[];
  private readonly pages: PdfPage[];
  private readonly outline: PdfOutlineItem[];
  private readonly pageCount: number;
  private readonly title: string | null;

  constructor(markdown: string = FIXTURE_MARKDOWN) {
    this.markdown = markdown.trimEnd() + '\n';
    this.items = parseHeadings(this.markdown);
    this.pageCount = Math.max(
      1,
      Math.ceil(this.markdown.length / CHARS_PER_PAGE),
    );
    this.pages = splitPages(this.markdown, this.pageCount);
    this.outline = synthesiseOutline(this.items);
    this.title = this.items.find((item) => item.level === 1)?.text ?? null;
  }

  extract(_input: PdfExtractInput): Promise<PdfExtraction> {
    void _input;
    return Promise.resolve({
      markdown: this.markdown,
      pages: this.pages.map((page) => ({ ...page })),
      items: this.items.map((item) => ({ ...item })),
      outline: this.outline.map((node) => ({
        ...node,
        children: node.children.map((child) => ({ ...child })),
      })),
      metadata: { title: this.title, author: null },
      pageCount: this.pageCount,
    });
  }
}
