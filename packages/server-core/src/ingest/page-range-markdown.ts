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
