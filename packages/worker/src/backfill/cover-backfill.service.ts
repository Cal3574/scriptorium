import { Inject, Injectable, Logger } from '@nestjs/common';
import { OBJECT_STORAGE, type ObjectStorage } from '@scriptorium/providers';
import { BooksRepository, renderBookCover } from '@scriptorium/server-core';

export interface CoverBackfillResult {
  processed: number;
  updated: number;
  skipped: number;
}

// Batch size per DB round trip - small enough to keep each pass's memory and
// per-book PDF fetch/render burst modest. Not a page offset: books that get a
// cover drop out of `listMissingCovers`'s `WHERE` clause on the next call, and
// books that fail are excluded by id (see below), so a fixed-size page is
// safe to just keep re-requesting until it comes back empty.
const BATCH_SIZE = 25;

/**
 * One-off backfill for books uploaded before the client started sending its
 * own rendered first-page thumbnail on `POST /books` (`coverImageUrl`):
 * fetches each such book's original PDF from object storage and renders page
 * 1 server-side with the same stack (`pdfjs-dist` + `@napi-rs/canvas`) the
 * client already trusts for its own deposit-slip preview.
 *
 * Invoked via `node dist/main.js --backfill-covers` (see `main.ts` / the
 * `worker:backfill-covers` Nx target) rather than the BullMQ queue: this is
 * an operator-triggered maintenance pass over existing rows, not a pipeline
 * stage a book's own ingest run depends on.
 *
 * A book that fails - PDF missing from storage, corrupt or password-
 * protected PDF, anything `renderPdfCover` throws on - is logged and skipped
 * rather than aborting the run; it is simply retried the next time this is
 * invoked; a cover is enrichment, never a blocker.
 */
@Injectable()
export class CoverBackfillService {
  private readonly logger = new Logger(CoverBackfillService.name);

  constructor(
    private readonly books: BooksRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async run(): Promise<CoverBackfillResult> {
    const result: CoverBackfillResult = {
      processed: 0,
      updated: 0,
      skipped: 0,
    };
    // Ids attempted (and not updated) so far *this run*: excluded from the
    // next page so a permanently-failing book cannot make the "keep paging
    // until empty" loop below spin forever.
    const skippedIds = new Set<string>();

    for (;;) {
      const batch = await this.books.listMissingCovers(BATCH_SIZE, [
        ...skippedIds,
      ]);
      if (batch.length === 0) break;

      for (const book of batch) {
        result.processed += 1;
        try {
          const dataUrl = await renderBookCover(this.storage, book);
          await this.books.setCoverImageUrl(book.id, dataUrl);
          result.updated += 1;
        } catch (err) {
          this.logger.warn(
            `book ${book.id}: cover render failed (${
              err instanceof Error ? err.message : String(err)
            }), skipping`,
          );
          result.skipped += 1;
          skippedIds.add(book.id);
        }
      }
    }

    return result;
  }
}
