import { renderPdfCover, type ObjectStorage } from '@scriptorium/providers';
import type { BookRow } from './books.repository.js';

/**
 * Fetch a book's original PDF from object storage and render its first page
 * to a small PNG `data:` URL - the one place both the worker's global
 * cover-backfill job (`CoverBackfillService`) and the API's self-service
 * `POST /me/backfill-covers` route turn a book into a cover, so the two never
 * drift on what "backfilling a cover" means.
 *
 * Throws (does not return `null`) on a missing PDF or an unrenderable one
 * (corrupt, empty, password-protected); both callers treat that as "skip
 * this book" rather than a hard failure.
 */
export async function renderBookCover(
  storage: ObjectStorage,
  book: Pick<BookRow, 'id' | 's3Key'>,
): Promise<string> {
  const pdf = await storage.getObject(book.s3Key);
  if (!pdf) {
    throw new Error(`original PDF missing at ${book.s3Key}`);
  }
  const { dataUrl } = await renderPdfCover(pdf);
  return dataUrl;
}
