import { randomUUID } from 'node:crypto';
import { createDbClient, type DbClient } from '@scriptorium/database/client';
import {
  FakeLlmClient,
  FakeObjectStorage,
  FakePdfExtractor,
  PdfExtractionError,
  type PdfExtractor,
} from '@scriptorium/providers';
import {
  BooksRepository,
  IngestEventStream,
  IngestRepository,
  RedisIngestEventSubscriber,
  sseFrame,
  type SseSink,
} from '@scriptorium/server-core';
import type { IngestEvent } from '@scriptorium/contracts';
import { IngestProcessor } from './ingest-processor.js';
import { RedisEventTransport } from './redis-event-transport.js';
import { StageEventPublisher } from './stage-event-publisher.js';
import {
  setupTestDatabase,
  type TestDatabase,
} from '../test-support/test-database.js';

const REDIS_URL = 'redis://localhost:6379';
const PDF_BYTES = Buffer.from('%PDF-1.7 fake bytes');

// Seam 2: the real ingest pipeline publishing over a real Redis, bridged by
// the real `IngestEventStream` (the core of `GET /books/:id/events`) reading
// the same Redis and a real Postgres. Asserts the browser-visible contract:
// snapshot first, monotonic seq, pipeline-ordered stage events, and a terminal
// event that closes the stream.
describe('live ingest progress: pipeline -> SSE bridge (Seam 2)', () => {
  let db: TestDatabase;
  let client: DbClient;
  let ingestRepo: IngestRepository;
  let booksRepo: BooksRepository;
  let transport: RedisEventTransport;
  let subscriber: RedisIngestEventSubscriber;
  let stream: IngestEventStream;
  let storage: FakeObjectStorage;
  let userId: string;

  function makeProcessor(pdfExtractor: PdfExtractor = new FakePdfExtractor()) {
    return new IngestProcessor(
      ingestRepo,
      new StageEventPublisher(transport),
      storage,
      pdfExtractor,
      new FakeLlmClient({ delayMs: 0 }),
    );
  }

  async function insertBook(): Promise<string> {
    const id = randomUUID();
    const s3Key = `books/${userId}/${randomUUID()}.pdf`;
    await db.pool.query(
      `INSERT INTO books (id, user_id, original_filename, s3_key, file_size_bytes, status)
       VALUES ($1, $2, 'the-quiet-craft.pdf', $3, $4, 'pending')`,
      [id, userId, s3Key, PDF_BYTES.length],
    );
    await storage.putObject(s3Key, PDF_BYTES, 'application/pdf');
    return id;
  }

  beforeAll(async () => {
    db = await setupTestDatabase();
    client = createDbClient(db.url);
    ingestRepo = new IngestRepository(client);
    booksRepo = new BooksRepository(client);
    transport = new RedisEventTransport(REDIS_URL);
    subscriber = new RedisIngestEventSubscriber(REDIS_URL);
    stream = new IngestEventStream(booksRepo, subscriber);
  });

  afterAll(async () => {
    await transport.close();
    await subscriber.close();
    await (
      client as unknown as { $client: { end: () => Promise<void> } }
    ).$client.end();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
    storage = new FakeObjectStorage();
    const [user] = (
      await db.pool.query(
        `INSERT INTO users (id, clerk_user_id, email) VALUES ($1, $2, $3) RETURNING id`,
        [randomUUID(), `u_${randomUUID()}`, 'seam2@example.com'],
      )
    ).rows;
    userId = user.id;
  });

  function collectingSink() {
    const frames: string[] = [];
    let closed = false;
    let onClose = () => undefined as void;
    const sink: SseSink = {
      write: (chunk) => void frames.push(chunk),
      close: () => {
        closed = true;
      },
      onClose: (cb) => {
        onClose = cb;
      },
    };
    return {
      sink,
      frames,
      isClosed: () => closed,
      disconnect: () => onClose(),
      events(): IngestEvent[] {
        return frames
          .join('')
          .split('\n\n')
          .filter((f) => f.startsWith('event:'))
          .map(
            (f) => JSON.parse(/data: (.*)/.exec(f)?.[1] ?? '{}') as IngestEvent,
          );
      },
      async waitFor(type: string, ms = 4000): Promise<void> {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (this.events().some((e) => e.type === type)) return;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(
          `timed out waiting for "${type}"; saw ${this.events()
            .map((e) => e.type)
            .join(', ')}`,
        );
      },
      async waitForCount(n: number, ms = 4000): Promise<void> {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (this.events().length >= n) return;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(
          `timed out waiting for ${n} events; saw ${this.events()
            .map((e) => e.type)
            .join(', ')}`,
        );
      },
    };
  }

  it('streams a snapshot, then the pipeline stage events in order with monotonic seq', async () => {
    const bookId = await insertBook();

    const session = await stream.open(bookId, userId);
    expect(session.snapshot).toMatchObject({
      type: 'snapshot',
      status: 'pending',
      seq: 0,
    });

    const sink = collectingSink();
    sink.sink.write(sseFrame(session.snapshot));
    const running = session.run(sink.sink, { heartbeatMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50));

    const outcome = await makeProcessor().process(bookId);
    expect(outcome).toEqual({ status: 'completed', lastStage: 'chunk' });

    // snapshot + extracting + book_identified + chunking.
    await sink.waitForCount(4);

    const types = sink.events().map((e) => e.type);
    expect(types).toEqual([
      'snapshot',
      'stage_entered',
      'book_identified',
      'stage_entered',
    ]);

    expect(sink.events()[1]).toMatchObject({ stage: 'extracting', seq: 1 });
    expect(sink.events()[3]).toMatchObject({ stage: 'chunking', seq: 3 });

    const seqs = sink.events().map((e) => e.seq);
    expect(seqs).toEqual([0, 1, 2, 3]);

    sink.disconnect();
    await running;
  });

  it('forwards a terminal book_failed event and closes the stream', async () => {
    const bookId = await insertBook();
    const session = await stream.open(bookId, userId);
    const sink = collectingSink();
    const running = session.run(sink.sink, { heartbeatMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50));

    const brokenExtractor: PdfExtractor = {
      extract: () =>
        Promise.reject(new PdfExtractionError('PDF_IS_BROKEN', false)),
    };
    await expect(
      makeProcessor(brokenExtractor).process(bookId),
    ).rejects.toThrow(/PDF_IS_BROKEN/);

    await sink.waitFor('book_failed');
    await running;

    expect(sink.isClosed()).toBe(true);
    const failed = sink.events().find((e) => e.type === 'book_failed');
    expect(failed).toMatchObject({ failedStage: 'extract' });
  });
});
