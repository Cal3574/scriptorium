import type { PdfPage } from '@scriptorium/providers';

// The markdown of an inclusive 1-based page range, in page order. It only needs
// the per-page markdown the extraction sidecar carries, so it lives here for
// any server package that reads the sidecar rather than in the worker's
// chapter-detection module.
export function pageRangeMarkdown(
  pages: PdfPage[],
  startPage: number,
  endPage: number,
): string {
  return [...pages]
    .sort((x, y) => x.page - y.page)
    .filter((p) => p.page >= startPage && p.page <= endPage)
    .map((p) => p.markdown)
    .join('\n\n')
    .trim();
}

// The stitched markdown for a detected chapter, applying the pipeline's
// page-1 / last-page fallbacks for a `chapters` row whose bounds are null. The
// chapter-summary stage and the chapter source endpoint both slice through
// here, so the source a reader reveals is the exact text the summary was
// written from.
export function chapterPageRangeMarkdown(
  artifact: { pages: PdfPage[]; pageCount: number },
  chapter: { pageStart: number | null; pageEnd: number | null },
): string {
  return pageRangeMarkdown(
    artifact.pages,
    chapter.pageStart ?? 1,
    chapter.pageEnd ?? artifact.pageCount,
  );
}
