// The seam between the ingest pipeline and PDF text extraction. The live
// adapter drives LlamaParse's async v2 REST API; the fake returns a committed
// book. Everything the pipeline needs from extraction is on `PdfExtraction`:
// the concatenated markdown (with `#`/`##` headings) and the `items` heading
// blocks that chapter detection keys off (see the chapter-detection spec).

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

export interface PdfExtraction {
  // The full book as one markdown string, `#` for the book title and `##` for
  // chapters, matching what LlamaParse's `expand=markdown` concatenates.
  markdown: string;
  // Heading blocks only, in document order.
  items: PdfHeadingItem[];
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
