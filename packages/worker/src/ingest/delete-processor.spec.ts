import { FakeObjectStorage, FakeQueue } from '@scriptorium/providers';
import type { BookRow, IngestRepository } from '@scriptorium/server-core';
import { DeleteProcessor } from './delete-processor.js';

const bookId = '11111111-1111-4111-8111-111111111111';

function bookRow(overrides: Partial<BookRow> = {}): BookRow {
  return {
    id: bookId,
    userId: 'user-1',
    title: 'The Quiet Craft',
    author: null,
    originalFilename: 'x.pdf',
    s3Key: `books/user-1/${bookId}.pdf`,
    fileSizeBytes: 10,
    pageCount: null,
    extractedMarkdownKey: null,
    summary: null,
    summaryGeneratedAt: null,
    status: 'extracting',
    failedStage: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BookRow;
}

class FakeRepo {
  book: BookRow | null;
  constructor(book: BookRow | null) {
    this.book = book;
  }
  findById = jest.fn((id: string): Promise<BookRow | null> =>
    Promise.resolve(this.book && this.book.id === id ? this.book : null),
  );
  deleteBook = jest.fn((): Promise<void> => {
    this.book = null;
    return Promise.resolve();
  });
}

function makeProcessor(
  repo: FakeRepo,
  storage: FakeObjectStorage,
  queue: FakeQueue,
) {
  return new DeleteProcessor(
    repo as unknown as IngestRepository,
    storage,
    queue,
    { activeJobTimeoutMs: 50, activeJobPollMs: 5 },
  );
}

describe('DeleteProcessor', () => {
  it('is a no-op when the book row is already gone', async () => {
    const repo = new FakeRepo(null);
    const storage = new FakeObjectStorage();
    const queue = new FakeQueue();

    const outcome = await makeProcessor(repo, storage, queue).process(bookId);

    expect(outcome).toEqual({ status: 'gone' });
    expect(repo.deleteBook).not.toHaveBeenCalled();
  });

  it('removes a queued ingest job, deletes both S3 objects and the row', async () => {
    const book = bookRow({
      extractedMarkdownKey: `books/user-1/${bookId}.md`,
    });
    const repo = new FakeRepo(book);
    const storage = new FakeObjectStorage();
    await storage.putObject(book.s3Key, Buffer.from('pdf'), 'application/pdf');
    await storage.putObject(
      book.extractedMarkdownKey as string,
      Buffer.from('# md'),
      'text/markdown',
    );
    const queue = new FakeQueue();
    await queue.enqueueIngest({ bookId });

    const outcome = await makeProcessor(repo, storage, queue).process(bookId);

    expect(outcome).toEqual({ status: 'deleted' });
    expect(await queue.ingestJobStatus(bookId)).toBe('missing');
    expect(await storage.getObject(book.s3Key)).toBeNull();
    expect(
      await storage.getObject(book.extractedMarkdownKey as string),
    ).toBeNull();
    expect(repo.deleteBook).toHaveBeenCalledWith(bookId);
  });

  it('tolerates a missing markdown key and absent S3 objects', async () => {
    const repo = new FakeRepo(bookRow({ extractedMarkdownKey: null }));
    const storage = new FakeObjectStorage();
    const queue = new FakeQueue();

    const outcome = await makeProcessor(repo, storage, queue).process(bookId);

    expect(outcome).toEqual({ status: 'deleted' });
  });

  it('waits out an active ingest job, then deletes anyway on timeout', async () => {
    const book = bookRow();
    const repo = new FakeRepo(book);
    const storage = new FakeObjectStorage();
    await storage.putObject(book.s3Key, Buffer.from('pdf'), 'application/pdf');
    const queue = new FakeQueue();
    await queue.enqueueIngest({ bookId });
    queue.setIngestJobState(bookId, 'active');

    const start = Date.now();
    const outcome = await makeProcessor(repo, storage, queue).process(bookId);

    expect(outcome).toEqual({ status: 'deleted' });
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    expect(repo.deleteBook).toHaveBeenCalledWith(bookId);
  });

  it('does not delete on a failed removal - waits the job out instead', async () => {
    const book = bookRow();
    const repo = new FakeRepo(book);
    const storage = new FakeObjectStorage();
    await storage.putObject(book.s3Key, Buffer.from('pdf'), 'application/pdf');
    const queue = new FakeQueue();
    await queue.enqueueIngest({ bookId });
    // Reads as removable but the removal keeps failing (another replica, or a
    // transient queue error swallowed to `false`), then the job finishes.
    jest.spyOn(queue, 'removeIngestJob').mockResolvedValue(false);
    setTimeout(() => queue.setIngestJobState(bookId, 'completed'), 15);

    const outcome = await makeProcessor(repo, storage, queue).process(bookId);

    expect(outcome).toEqual({ status: 'deleted' });
    expect(repo.deleteBook).toHaveBeenCalledWith(bookId);
  });

  it('proceeds as soon as an active ingest job clears', async () => {
    const book = bookRow();
    const repo = new FakeRepo(book);
    const storage = new FakeObjectStorage();
    await storage.putObject(book.s3Key, Buffer.from('pdf'), 'application/pdf');
    const queue = new FakeQueue();
    await queue.enqueueIngest({ bookId });
    queue.setIngestJobState(bookId, 'active');
    setTimeout(() => queue.setIngestJobState(bookId, 'completed'), 15);

    const start = Date.now();
    await makeProcessor(repo, storage, queue).process(bookId);

    expect(Date.now() - start).toBeLessThan(50);
    expect(repo.deleteBook).toHaveBeenCalled();
  });
});
