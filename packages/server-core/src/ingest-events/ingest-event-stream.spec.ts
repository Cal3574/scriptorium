import type { IngestEvent } from '@scriptorium/contracts';
import type { BookRow } from '../books/books.repository.js';
import { ResourceNotFoundException } from '../http/problem.exception.js';
import { IngestEventStream } from './ingest-event-stream.js';
import type { SseSink } from './sse.js';

const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';

function bookRow(overrides: Partial<BookRow> = {}): BookRow {
  return {
    id: BOOK_ID,
    userId: OWNER,
    title: null,
    author: null,
    originalFilename: 'book.pdf',
    s3Key: 'k',
    fileSizeBytes: 1,
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

class FakeSubscriber {
  seq = 0;
  private handler: ((e: IngestEvent) => void) | null = null;
  unsubscribed = false;
  currentSeq = () => Promise.resolve(this.seq);
  subscribe = (_id: string, onEvent: (e: IngestEvent) => void) => {
    this.handler = onEvent;
    return Promise.resolve(() => {
      this.unsubscribed = true;
    });
  };
  close = () => Promise.resolve();
  emit(event: IngestEvent) {
    this.handler?.(event);
  }
}

class FakeSink implements SseSink {
  writes: string[] = [];
  closed = false;
  private onCloseCb: (() => void) | null = null;
  write = (chunk: string) => void this.writes.push(chunk);
  close = () => {
    this.closed = true;
  };
  onClose = (cb: () => void) => void (this.onCloseCb = cb);
  disconnect() {
    this.onCloseCb?.();
  }
  get body() {
    return this.writes.join('');
  }
}

function makeStream(
  overrides: Partial<{ findById: unknown; countChapters: unknown }> = {},
) {
  const subscriber = new FakeSubscriber();
  const repo = {
    findById: jest.fn().mockResolvedValue(bookRow()),
    countChapters: jest.fn().mockResolvedValue({ total: 0, summarized: 0 }),
    ...overrides,
  };
  const stream = new IngestEventStream(repo as never, subscriber as never);
  return { stream, subscriber, repo };
}

const tick = () => new Promise((r) => setTimeout(r, 30));

describe('IngestEventStream.open', () => {
  it('404s when the book is missing', async () => {
    const { stream } = makeStream({
      findById: jest.fn().mockResolvedValue(null),
    });
    await expect(stream.open(BOOK_ID, OWNER)).rejects.toBeInstanceOf(
      ResourceNotFoundException,
    );
  });

  it('404s when the book belongs to someone else', async () => {
    const { stream } = makeStream({
      findById: jest
        .fn()
        .mockResolvedValue(bookRow({ userId: 'someone-else' })),
    });
    await expect(stream.open(BOOK_ID, OWNER)).rejects.toBeInstanceOf(
      ResourceNotFoundException,
    );
  });

  it('subscribes before reading the seq, so a gap event is not lost', async () => {
    const { stream, subscriber } = makeStream();
    // currentSeq resolves only after we have had a chance to publish.
    subscriber.currentSeq = () =>
      new Promise((resolve) => setTimeout(() => resolve(0), 20));

    const opening = stream.open(BOOK_ID, OWNER);
    await new Promise((r) => setTimeout(r, 5));
    subscriber.emit({
      type: 'stage_entered',
      bookId: BOOK_ID,
      seq: 1,
      stage: 'extracting',
      status: 'extracting',
    });
    const session = await opening;

    const sink = new FakeSink();
    void session.run(sink, { heartbeatMs: 10_000 });
    await tick();
    expect(sink.body).toContain('event: stage_entered');
    sink.disconnect();
  });

  it('builds a snapshot carrying the current seq', async () => {
    const { stream, subscriber } = makeStream();
    subscriber.seq = 7;
    const session = await stream.open(BOOK_ID, OWNER);
    expect(session.snapshot).toMatchObject({
      type: 'snapshot',
      seq: 7,
      stage: 'extracting',
    });
    session.close();
  });
});

describe('IngestStreamSession.run', () => {
  it('writes fresh events and drops any at or below the snapshot seq', async () => {
    const { stream, subscriber } = makeStream();
    subscriber.seq = 5;
    const session = await stream.open(BOOK_ID, OWNER);
    const sink = new FakeSink();
    const done = session.run(sink, { heartbeatMs: 10_000 });
    await tick();

    subscriber.emit({
      type: 'book_identified',
      bookId: BOOK_ID,
      seq: 4,
      title: 'x',
      author: null,
    });
    subscriber.emit({
      type: 'stage_entered',
      bookId: BOOK_ID,
      seq: 6,
      stage: 'chunking',
      status: 'chunking',
    });

    expect(sink.body).not.toContain('"seq":4');
    expect(sink.body).toContain('event: stage_entered');

    sink.disconnect();
    await done;
    expect(subscriber.unsubscribed).toBe(true);
  });

  it('closes the stream on the first terminal event', async () => {
    const { stream, subscriber } = makeStream();
    const session = await stream.open(BOOK_ID, OWNER);
    const sink = new FakeSink();
    const done = session.run(sink, { heartbeatMs: 10_000 });
    await tick();

    subscriber.emit({
      type: 'book_completed',
      bookId: BOOK_ID,
      seq: 3,
      status: 'ready',
    });
    await done;

    expect(sink.closed).toBe(true);
    expect(sink.body).toContain('event: book_completed');
    expect(subscriber.unsubscribed).toBe(true);
  });

  it('emits book_deleted and closes when a keep-alive finds the row gone', async () => {
    const findById = jest
      .fn()
      .mockResolvedValueOnce(bookRow())
      .mockResolvedValue(null);
    const { stream } = makeStream({ findById });
    const session = await stream.open(BOOK_ID, OWNER);
    const sink = new FakeSink();

    await session.run(sink, { heartbeatMs: 15 });

    expect(sink.body).toContain(': keep-alive');
    expect(sink.body).toContain('event: book_deleted');
    expect(sink.closed).toBe(true);
  });
});
