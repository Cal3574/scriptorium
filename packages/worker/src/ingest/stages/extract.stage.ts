import { withRetry } from '../retry.js';
import { TerminalIngestError } from '../errors.js';
import type { Stage } from '../stage.js';
import type { BookRow } from '@scriptorium/server-core';

// The permanent markdown blob lives next to the original PDF, same key with a
// `.md` extension: `books/{userId}/{uuid}.md`. Deleting a book removes both.
// The suffix swap must actually change the key - otherwise the markdown write
// would overwrite the original PDF.
export function extractedMarkdownKey(book: BookRow): string {
  const key = book.s3Key.replace(/\.pdf$/i, '.md');
  if (key === book.s3Key) return `${book.s3Key}.md`;
  return key;
}

/**
 * Stage 1. Run the PDF through the extractor, store the full markdown as a
 * permanent S3 object, and record the page count. Complete once
 * `extracted_markdown_key` is set, so a re-run never re-parses.
 */
export const extractStage: Stage = {
  name: 'extract',
  enterStatus: 'extracting',

  isComplete(book): Promise<boolean> {
    return Promise.resolve(book.extractedMarkdownKey != null);
  },

  async run(book, { storage, pdfExtractor, repo }): Promise<void> {
    const pdf = await storage.getObject(book.s3Key);
    if (!pdf) {
      throw new TerminalIngestError(`original PDF is missing at ${book.s3Key}`);
    }

    const extraction = await withRetry(() =>
      pdfExtractor.extract({ data: pdf, filename: book.originalFilename }),
    );

    const markdownKey = extractedMarkdownKey(book);
    await storage.putObject(
      markdownKey,
      Buffer.from(extraction.markdown, 'utf-8'),
      'text/markdown',
    );
    await repo.recordExtraction(book.id, {
      extractedMarkdownKey: markdownKey,
      pageCount: extraction.pageCount,
    });
  },
};
