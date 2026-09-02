// The seam between the ingest pipeline and PDF text extraction. The live
// adapter drives LlamaParse's async v2 REST API (plus a `pdfjs-dist` pass over
// the same bytes for the bookmark outline); the fake returns a committed book.
// Everything chapter detection and chunking need is on `PdfExtraction`: the
// concatenated markdown, the per-page markdown, the `items` heading blocks, the
// PDF bookmark `outline`, and the document `metadata` (see the
// chapter-detection spec).

// One structured block from the parse. The pipeline only consumes heading
// blocks, so that is all the fake synthesises and all this type models; the
// live adapter simply drops every non-heading block LlamaParse returns.
export interface PdfHeadingItem {
  type: 'heading';
  // Markdown heading level: 1 for `#`, 2 for `##`. Per the chapter-detection
  // spec this is a weak signal (LlamaParse assigns it from visual size), so
  // it is carried but never load-bearing.
  level: number;
  // The heading text, verbatim, without the leading `#` markers.
  text: string;
  // 1-based page the heading falls on. Consecutive heading pages are what the
  // detector turns into chapter page ranges.
  page: number;
}

// One entry in the PDF's bookmark tree, from `pdfjs-dist`'s `getOutline()`.
// The detector uses these to corroborate marker pages and as the primary
// chapter list when the markdown yields fewer than two markers.
export interface PdfOutlineItem {
  // Bookmark label, verbatim.
  title: string;
  // 1-based page the bookmark points at, or null when its destination could
  // not be resolved to a page (a malformed dest, an external link).
  page: number | null;
  // Nested bookmarks. Only the top level is treated as chapters.
  children: PdfOutlineItem[];
}

// Document-level metadata. `title`/`author` here come from the PDF's own
// metadata dictionary, distinct from the `identifyBook` LLM guess.
export interface PdfMetadata {
  title: string | null;
  author: string | null;
}

// The markdown for a single printed page, 1-based.
export interface PdfPage {
  page: number;
  markdown: string;
}

export interface PdfExtraction {
  // The full book as one markdown string, `#` for the book title and `##` for
  // chapters, matching what LlamaParse's `expand=markdown` concatenates.
  markdown: string;
  // The same content split per printed page, in page order. Chapter detection
  // reads individual pages (TOC scan) and chunking slices by page range.
  pages: PdfPage[];
  // Heading blocks only, in document order.
  items: PdfHeadingItem[];
  // The PDF bookmark tree, empty when the document has no bookmarks or the
  // outline pass failed (non-fatal - detection has markdown fallbacks).
  outline: PdfOutlineItem[];
  // Document metadata from the PDF itself.
  metadata: PdfMetadata;
  // Printed page count as reported by the parser.
  pageCount: number;
}

export interface PdfExtractInput {
  // The raw PDF bytes. The fake ignores them.
  data: Uint8Array;
  // Original filename, used by the live adapter for the multipart upload part
  // and by both adapters for logging.
  filename: string;
}

export interface PdfExtractor {
  extract(input: PdfExtractInput): Promise<PdfExtraction>;
}

/**
 * Thrown by an extractor when a parse fails. `retryable` is the seam the
 * ingest pipeline keys off: `false` for a broken or password-protected PDF, a
 * non-429 4xx, or an auth failure (the book is marked `failed`); `true` for
 * 429 / 5xx / timeout / network blips (the job is retried).
 */
export class PdfExtractionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PdfExtractionError';
  }
}

// Nest DI token. A plain symbol keeps `@scriptorium/providers` free of a
// framework dependency; `server-core` binds it to an implementation.
export const PDF_EXTRACTOR = Symbol('PdfExtractor');
