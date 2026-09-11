import type { ExtractionArtifact } from './extraction-artifact.js';
import { chapterPageRangeMarkdown } from './page-range-markdown.js';

// Hard cap on the stitched chapter source `text` (~200 KB ≈ 50k tokens). Larger
// than any real single chapter - only the whole-book-as-one-chapter detection
// fallback exceeds it. Over the cap the text is truncated on a paragraph
// boundary and `truncated` is set; there is no within-chapter pagination.
export const CHAPTER_SOURCE_MAX_BYTES = 200 * 1024;

export interface ChapterSourceText {
  // False when there is no usable source: the page range yielded only
  // whitespace, or the extraction artifact is missing.
  available: boolean;
  // GFM markdown, or null when `available` is false.
  text: string | null;
  // True when `text` was capped at `maxBytes`.
  truncated: boolean;
}

const UNAVAILABLE: ChapterSourceText = {
  available: false,
  text: null,
  truncated: false,
};

// Slice `artifact` over the chapter's page range and stitch the pages back into
// one markdown string (via the shared `chapterPageRangeMarkdown`, so the text
// matches what the chapter-summary stage was written from), then apply the size
// ceiling. A null artifact or an all-whitespace range is the quiet "source
// unavailable" state, not an error.
export function buildChapterSource(
  artifact: ExtractionArtifact | null,
  chapter: { pageStart: number | null; pageEnd: number | null },
  maxBytes: number = CHAPTER_SOURCE_MAX_BYTES,
): ChapterSourceText {
  if (!artifact) return UNAVAILABLE;

  const raw = chapterPageRangeMarkdown(artifact, chapter);
  if (raw.trim().length === 0) return UNAVAILABLE;

  return capToBytes(raw, maxBytes);
}

const SEPARATOR_BYTES = 2; // '\n\n' between kept paragraphs

function capToBytes(text: string, maxBytes: number): ChapterSourceText {
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) {
    return { available: true, text, truncated: false };
  }

  const paragraphs = text.split('\n\n');
  const kept: string[] = [];
  let keptBytes = 0;
  for (const paragraph of paragraphs) {
    const cost =
      Buffer.byteLength(paragraph, 'utf-8') +
      (kept.length === 0 ? 0 : SEPARATOR_BYTES);
    if (keptBytes + cost > maxBytes) break;
    kept.push(paragraph);
    keptBytes += cost;
  }

  // A single leading paragraph already over the ceiling (only the whole-book
  // fallback gets here): hard-cut it without splitting a UTF-8 code point.
  const cappedText =
    kept.length > 0 ? kept.join('\n\n') : hardCut(paragraphs[0], maxBytes);

  return { available: true, text: cappedText, truncated: true };
}

function hardCut(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf-8');
  if (buffer.length <= maxBytes) return text;
  // Back up off any trailing UTF-8 continuation bytes so the cut lands on a
  // code-point boundary.
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
  return buffer.toString('utf-8', 0, end);
}
