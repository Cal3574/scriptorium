import type {
  ObjectStorage,
  PdfExtraction,
  PdfHeadingItem,
  PdfMetadata,
  PdfOutlineItem,
  PdfPage,
} from '@scriptorium/providers';
import type { BookRow } from '../books/books.repository.js';

// The `extract` stage persists two artifacts next to the original PDF: the
// human-readable `.md` blob (read by `identifyBook`) and this structured JSON
// sidecar (read by `chunk`). The sidecar carries everything chapter detection
// needs - per-page markdown, heading blocks, the PDF outline, metadata - so the
// `chunk` stage never re-parses the PDF.
export interface ExtractionArtifact {
  pages: PdfPage[];
  items: PdfHeadingItem[];
  outline: PdfOutlineItem[];
  metadata: PdfMetadata;
  pageCount: number;
}

// `books/{userId}/{uuid}.pdf` -> `books/{userId}/{uuid}.extraction.json`. The
// swap must change the key or the write would clobber the original PDF.
export function extractionArtifactKey(book: BookRow): string {
  const key = book.s3Key.replace(/\.pdf$/i, '.extraction.json');
  return key === book.s3Key ? `${book.s3Key}.extraction.json` : key;
}

export function toExtractionArtifact(
  extraction: PdfExtraction,
): ExtractionArtifact {
  return {
    pages: extraction.pages,
    items: extraction.items,
    outline: extraction.outline,
    metadata: extraction.metadata,
    pageCount: extraction.pageCount,
  };
}

export async function saveExtractionArtifact(
  storage: ObjectStorage,
  key: string,
  artifact: ExtractionArtifact,
): Promise<void> {
  await storage.putObject(
    key,
    Buffer.from(JSON.stringify(artifact), 'utf-8'),
    'application/json',
  );
}

export async function loadExtractionArtifact(
  storage: ObjectStorage,
  key: string,
): Promise<ExtractionArtifact | null> {
  const bytes = await storage.getObject(key);
  if (!bytes) return null;
  return JSON.parse(Buffer.from(bytes).toString('utf-8')) as ExtractionArtifact;
}

// Every reader of the sidecar treats its absence as an unrecoverable invariant
// breach, but each wants its own error type (the worker a terminal ingest
// failure, an HTTP caller a problem response), so the caller supplies the
// factory rather than this module hard-coding one.
export async function requireExtractionArtifact(
  storage: ObjectStorage,
  book: BookRow,
  onMissing: (book: BookRow) => Error,
): Promise<ExtractionArtifact> {
  const artifact = await loadExtractionArtifact(
    storage,
    extractionArtifactKey(book),
  );
  if (!artifact) {
    throw onMissing(book);
  }
  return artifact;
}
