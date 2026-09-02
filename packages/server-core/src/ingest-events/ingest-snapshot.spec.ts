import type { BookRow } from '../books/books.repository.js';
import { buildIngestSnapshot } from './ingest-snapshot.js';

function bookRow(overrides: Partial<BookRow> = {}): BookRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    title: null,
    author: null,
    originalFilename: 'book.pdf',
    s3Key: 'books/u/book.pdf',
    fileSizeBytes: 1234,
    pageCount: null,
    extractedMarkdownKey: null,
    summary: null,
    summaryGeneratedAt: null,
    status: 'pending',
    failedStage: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BookRow;
}

describe('buildIngestSnapshot', () => {
  it('projects an in-progress status to its active stage', () => {
    const snapshot = buildIngestSnapshot({
      book: bookRow({ status: 'embedding', title: 'T', author: 'A' }),
      chaptersTotal: 8,
      chaptersSummarized: 3,
      seq: 12,
    });

    expect(snapshot).toMatchObject({
      type: 'snapshot',
      seq: 12,
      status: 'embedding',
      stage: 'embedding',
      progress: null,
      chaptersTotal: 8,
      chaptersSummarized: 3,
      title: 'T',
      author: 'A',
    });
  });

  it.each(['pending', 'ready', 'failed', 'deleting'] as const)(
    'reports no active stage for %s',
    (status) => {
      expect(
        buildIngestSnapshot({
          book: bookRow({ status }),
          chaptersTotal: 0,
          chaptersSummarized: 0,
          seq: 0,
        }).stage,
      ).toBeNull();
    },
  );

  it('carries the failure stage and reason through', () => {
    const snapshot = buildIngestSnapshot({
      book: bookRow({
        status: 'failed',
        failedStage: 'embed',
        failureReason: 'provider timeout',
      }),
      chaptersTotal: 0,
      chaptersSummarized: 0,
      seq: 4,
    });
    expect(snapshot.failedStage).toBe('embed');
    expect(snapshot.failureReason).toBe('provider timeout');
  });
});
