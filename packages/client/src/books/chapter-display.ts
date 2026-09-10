import type { ChapterDto } from '@scriptorium/contracts';

// Shared display helpers for a chapter across Book-detail's index and the
// reader, so the title fallback, the page range and the mono ordinal read the
// same everywhere.

// "41-58" for a chapter that has both page bounds, else null - never a
// half-open "41-". The separator is an en dash, the typographic form for a
// numeric range.
export function pageRange(
  chapter: Pick<ChapterDto, 'pageStart' | 'pageEnd'>,
): string | null {
  const { pageStart, pageEnd } = chapter;
  if (pageStart == null || pageEnd == null) return null;
  return `${pageStart}–${pageEnd}`;
}

// The chapter's display heading: its own title, or "Chapter N" (1-based) when
// the detector never named it.
export function chapterHeading(
  chapter: Pick<ChapterDto, 'title'>,
  number: number,
): string {
  return chapter.title ?? `Chapter ${number}`;
}

// Two-digit zero-padded chapter number for the mono counter and the TOC rail.
export function chapterOrdinal(number: number): string {
  return String(number).padStart(2, '0');
}
