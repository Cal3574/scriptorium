import type { PdfHeadingItem, PdfPage } from './pdf-extractor.js';

// Derive the `items` heading blocks from per-page markdown by pulling every
// ATX heading line (`# ` .. `###### `) out of each page. This matches the
// fidelity `detectChapters` needs: it regexes over heading *text*, and `level`
// is explicitly a weak signal (see the chapter-detection spec). Setext
// headings (`===` / `---` underlines) are not emitted by the transcription
// prompt, so they are not handled here.

const HEADING = /^(#{1,6})[ \t]+(.*\S)[ \t]*$/;

// A line that starts a new markdown block, so it cannot be the wrapped
// continuation of a heading above it.
const BLOCK_START =
  /^(#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|>|\||```|~~~|-{3,}$|\*{3,}$|_{3,}$)/;

// When a long heading wraps, Gemini emits the tail on the next line with no
// blank line between - `# Chapter 5: Identifying Architectural\nCharacteristics`.
// Fold that tail back in so the title is not truncated. Kept deliberately
// narrow so a heading that simply butts against a paragraph is not swallowed:
// only a short continuation line that does not end like a sentence, and only
// while the text so far has no sentence-ending punctuation, is folded.
const SENTENCE_END = /[.!?]$/;
const CONTINUATION_MAX_CHARS = 50;

function headingText(
  lines: string[],
  startIndex: number,
  base: string,
): string {
  let text = base;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0 || BLOCK_START.test(line)) break;
    if (line.length > CONTINUATION_MAX_CHARS) break;
    if (SENTENCE_END.test(text) || SENTENCE_END.test(line)) break;
    text = `${text} ${line}`;
  }
  return text;
}

export function deriveHeadings(pages: PdfPage[]): PdfHeadingItem[] {
  const items: PdfHeadingItem[] = [];
  for (const page of pages) {
    const lines = page.markdown.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = HEADING.exec(lines[i]);
      if (!match) continue;
      items.push({
        type: 'heading',
        level: match[1].length,
        text: headingText(lines, i, match[2].trim()),
        page: page.page,
      });
    }
  }
  return items;
}
