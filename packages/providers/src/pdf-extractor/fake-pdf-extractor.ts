import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  PdfExtractInput,
  PdfExtraction,
  PdfExtractor,
  PdfHeadingItem,
} from './pdf-extractor.js';

// Roughly how many markdown characters map to one printed page. Only used to
// synthesise plausible, monotonically increasing `page` numbers for the
// heading blocks so chapter detection has consecutive pages to turn into
// ranges. The exact value does not matter; consistency across a run does.
const CHARS_PER_PAGE = 900;

// The committed fixture. Read once at module load. `join(__dirname, ...)` is
// resolved by both `@swc/jest` (jest injects `__dirname`) and the webpack
// node build used by the apps.
const FIXTURE_MARKDOWN = readFileSync(
  join(__dirname, 'fixtures', 'sample-book.md'),
  'utf8',
);

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
        page: Math.floor(offset / CHARS_PER_PAGE) + 1,
      });
    }
    offset += line.length + 1;
  }
  return items;
}

/**
 * Offline {@link PdfExtractor}. Ignores the input bytes and returns a committed
 * book with real `#`/`##` headings plus `items` heading blocks whose pages are
 * synthesised from the headings' position in the markdown, so the whole ingest
 * pipeline - extract, chapter detection, chunking, summarising - runs with zero
 * cost and no network.
 */
export class FakePdfExtractor implements PdfExtractor {
  private readonly markdown: string;
  private readonly items: PdfHeadingItem[];
  private readonly pageCount: number;

  constructor(markdown: string = FIXTURE_MARKDOWN) {
    this.markdown = markdown.trimEnd() + '\n';
    this.items = parseHeadings(this.markdown);
    this.pageCount = Math.max(
      1,
      Math.ceil(this.markdown.length / CHARS_PER_PAGE),
    );
  }

  extract(_input: PdfExtractInput): Promise<PdfExtraction> {
    void _input;
    return Promise.resolve({
      markdown: this.markdown,
      items: this.items.map((item) => ({ ...item })),
      pageCount: this.pageCount,
    });
  }
}
