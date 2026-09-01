import { UnrecoverableError } from 'bullmq';
import {
  FakeLlmClient,
  FakeObjectStorage,
  FakePdfExtractor,
  PdfExtractionError,
  type PdfExtractor,
} from '@scriptorium/providers';
import type { BookRow, IngestRepository } from '@scriptorium/server-core';
import { IngestProcessor } from './ingest-processor.js';
import { StageEventPublisher } from './stage-event-publisher.js';
import { InMemoryEventTransport } from './event-transport.js';
import type { Stage } from './stage.js';
import { TerminalIngestError } from './errors.js';

function bookRow(overrides: Partial<BookRow>): BookRow {
  return {
    id: 'book-1',
    userId: 'user-1',
    title: null,
    author: null,
    originalFilename: 'x.pdf',
    s3Key: 'books/user-1/x.pdf',
    fileSizeBytes: 10,
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

// In-memory stand-in for the DB-backed repository.
class FakeRepo {
  constructor(private book: BookRow) {}
  findById = jest.fn((id: string): Promise<BookRow | null> =>
    Promise.resolve(id === this.book.id ? this.book : null),
  );
  setStatus = jest.fn((_: string, status: BookRow['status']) => {
    this.book = { ...this.book, status };
    return Promise.resolve();
  });
  recordExtraction = jest.fn(
    (_: string, r: { extractedMarkdownKey: string; pageCount: number }) => {
      this.book = { ...this.book, ...r };
      return Promise.resolve();
    },
  );
  recordIdentification = jest.fn(
    (_: string, i: { title: string | null; author: string | null }) => {
      if (this.book.title === null && i.title) {
        this.book = { ...this.book, title: i.title };
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    },
  );
  markFailed = jest.fn(
    (_: string, m: { failedStage: string; failureReason: string }) => {
      this.book = { ...this.book, status: 'failed', ...m };
      return Promise.resolve();
    },
  );
  get current() {
    return this.book;
  }
}

function build(book: BookRow, pdfExtractor: PdfExtractor = new FakePdfExtractor()) {
  const repo = new FakeRepo(book);
  const transport = new InMemoryEventTransport();
  const storage = new FakeObjectStorage();
  const processor = new IngestProcessor(
    repo as unknown as IngestRepository,
    new StageEventPublisher(transport),
    storage,
    pdfExtractor,
    new FakeLlmClient({ delayMs: 0 }),
  );
  return { repo, transport, storage, processor };
}

describe('IngestProcessor', () => {
  it('walks extract then identifyBook and completes', async () => {
    const book = bookRow({ status: 'pending' });
    const { processor, repo, storage } = build(book);
    await storage.putObject(book.s3Key, Buffer.from('pdf'), 'application/pdf');

    const outcome = await processor.process(book.id);

    expect(outcome).toEqual({ status: 'completed', lastStage: 'identifyBook' });
    expect(repo.current.status).toBe('extracting');
    expect(repo.current.extractedMarkdownKey).toBe('books/user-1/x.md');
    expect(repo.current.title).toBe('The Quiet Craft of Habit');
  });

  it('aborts at the first boundary when the book is deleting', async () => {
    const { processor, repo } = build(bookRow({ status: 'deleting' }));
    const outcome = await processor.process('book-1');
    expect(outcome).toEqual({ status: 'aborted' });
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it('returns gone when the book has vanished', async () => {
    const { processor } = build(bookRow({}));
    expect(await processor.process('other-id')).toEqual({ status: 'gone' });
  });

  it('marks failed and throws UnrecoverableError on a terminal stage error', async () => {
    const book = bookRow({ status: 'pending' });
    const failing: Stage = {
      name: 'extract',
      enterStatus: 'extracting',
      isComplete: () => Promise.resolve(false),
      run: () => Promise.reject(new TerminalIngestError('boom')),
    };
    const { processor, repo, transport } = build(book);
    processor.stages = [failing];

    await expect(processor.process(book.id)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(repo.current.status).toBe('failed');
    expect(repo.current.failedStage).toBe('extract');
    expect(
      transport.eventsFor<{ type: string }>(`book:events:${book.id}`).map((e) => e.type),
    ).toContain('book_failed');
  });

  it('propagates a retryable error without failing the book (not final attempt)', async () => {
    const book = bookRow({ status: 'pending' });
    const flaky: Stage = {
      name: 'extract',
      enterStatus: 'extracting',
      isComplete: () => Promise.resolve(false),
      run: () => Promise.reject(new PdfExtractionError('502', true)),
    };
    const { processor, repo } = build(book);
    processor.stages = [flaky];

    await expect(processor.process(book.id)).rejects.toThrow('502');
    expect(repo.current.status).toBe('extracting');
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('promotes a retryable error to failed on the final attempt', async () => {
    const book = bookRow({ status: 'pending' });
    const flaky: Stage = {
      name: 'extract',
      enterStatus: 'extracting',
      isComplete: () => Promise.resolve(false),
      run: () => Promise.reject(new PdfExtractionError('502', true)),
    };
    const { processor, repo } = build(book);
    processor.stages = [flaky];

    await expect(
      processor.process(book.id, { finalAttempt: true }),
    ).rejects.toThrow('502');
    expect(repo.current.status).toBe('failed');
    expect(repo.current.failureReason).toContain('retries exhausted');
  });

  it('skips a stage whose artifact already exists', async () => {
    const book = bookRow({
      status: 'extracting',
      extractedMarkdownKey: 'books/user-1/x.md',
      title: 'Already Known',
    });
    const { processor, repo } = build(book, {
      extract: () => {
        throw new Error('should not run');
      },
    });

    const outcome = await processor.process(book.id);
    expect(outcome).toEqual({ status: 'completed', lastStage: 'identifyBook' });
    expect(repo.recordExtraction).not.toHaveBeenCalled();
  });
});
