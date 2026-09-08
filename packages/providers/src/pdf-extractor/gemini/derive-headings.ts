import type { PdfHeadingItem, PdfPage } from '../pdf-extractor.js';

// Derive the `items` heading blocks from per-page markdown by pulling every
// ATX heading line (`# ` .. `###### `) out of each page. This matches the
// fidelity `detectChapters` needs: it regexes over heading *text*, and `level`
// is explicitly a weak signal (see the chapter-detection spec). Setext
// headings (`===` / `---` underlines) are not emitted by the transcription
// prompt, so they are not handled here.

const HEADING = /^(#{1,6})[ \t]+(.*\S)[ \t]*$/;

export function deriveHeadings(pages: PdfPage[]): PdfHeadingItem[] {
  const items: PdfHeadingItem[] = [];
  for (const page of pages) {
    for (const line of page.markdown.split('\n')) {
      const match = HEADING.exec(line);
      if (!match) continue;
      items.push({
        type: 'heading',
        level: match[1].length,
        text: match[2].trim(),
        page: page.page,
      });
    }
  }
  return items;
}
