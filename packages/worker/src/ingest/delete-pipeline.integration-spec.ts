import { randomUUID } from 'node:crypto';
import { createDbClient, type DbClient } from '@scriptorium/database/client';
import {
  FakeLlmClient,
  FakeObjectStorage,
  FakePdfExtractor,
  FakeQueue,
} from '@scriptorium/providers';
import { IngestRepository } from '@scriptorium/server-core';
import { IngestProcessor } from './ingest-processor.js';
import { DeleteProcessor } from './delete-processor.js';
import { StageEventPublisher } from './stage-event-publisher.js';
import { InMemoryEventTransport } from './event-transport.js';
import {
  setupTestDatabase,
  type TestDatabase,
} from '../test-support/test-database.js';

// Seam 2: the real delete job (DeleteProcessor) against a real Postgres, with
// the offline provider fakes. Proves a hard delete tears down everything
// derived from a book - even mid-ingest - while query history survives.
describe('book hard delete (Seam 2)', () => {
  let db: TestDatabase;
  let client: DbClient;
  let repo: IngestRepository;
  let storage: FakeObjectStorage;
  let queue: FakeQueue;
  let userId: string;

  const PDF_BYTES = Buffer.from('%PDF-1.7 fake bytes');

  function makeIngestProcessor() {
    const publisher = new StageEventPublisher(new InMemoryEventTransport());
    return new IngestProcessor(
      repo,
      publisher,
      storage,
      new FakePdfExtractor(),
      new FakeLlmClient({ delayMs: 0 }),
    );
  }

  function makeDeleteProcessor() {
    return new DeleteProcessor(repo, storage, queue, {
      activeJobTimeoutMs: 50,
      activeJobPollMs: 5,
    });
  }

  async function insertBook() {
    const id = randomUUID();
    const s3Key = `books/${userId}/${randomUUID()}.pdf`;
    await db.pool.query(
      `INSERT INTO books (id, user_id, original_filename, s3_key, file_size_bytes, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [id, userId, 'the-quiet-craft.pdf', s3Key, PDF_BYTES.length],
    );
    await storage.putObject(s3Key, PDF_BYTES, 'application/pdf');
    return { id, s3Key };
  }

  const countWhere = async (table: string, id: string) =>
    (
      await db.pool.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE book_id = $1`,
        [id],
      )
    ).rows[0].n as number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    client = createDbClient(db.url);
    repo = new IngestRepository(client);
  });

  afterAll(async () => {
    await (
      client as unknown as { $client: { end: () => Promise<void> } }
    ).$client.end();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
    storage = new FakeObjectStorage();
    queue = new FakeQueue();
    const [user] = (
      await db.pool.query(
        `INSERT INTO users (id, clerk_user_id, email)
         VALUES ($1, $2, $3) RETURNING id`,
        [randomUUID(), 'user_del', 'del@example.com'],
      )
    ).rows;
    userId = user.id;
  });

  it('stops a mid-ingest pipeline and removes every row and both S3 objects', async () => {
    const { id, s3Key } = await insertBook();

    // Drive the pipeline through chunk so there are chapters, chunks and a
    // markdown artifact to clean up.
    await makeIngestProcessor().process(id);
    const markdownKey = (await repo.findById(id))?.extractedMarkdownKey ?? '';
    expect(markdownKey).not.toBe('');
    expect(await countWhere('chapters', id)).toBeGreaterThan(0);
    expect(await countWhere('chunks', id)).toBeGreaterThan(0);

    // A delete lands: the API has flipped the status and queued the job.
    await db.pool.query(`UPDATE books SET status = 'deleting' WHERE id = $1`, [
      id,
    ]);
    await queue.enqueueIngest({ bookId: id });

    // The in-flight ingest observes the abort at the next stage boundary.
    expect(await makeIngestProcessor().process(id)).toEqual({
      status: 'aborted',
    });

    const outcome = await makeDeleteProcessor().process(id);

    expect(outcome).toEqual({ status: 'deleted' });
    expect(await repo.findById(id)).toBeNull();
    expect(await countWhere('chapters', id)).toBe(0);
    expect(await countWhere('chunks', id)).toBe(0);
    expect(await storage.getObject(s3Key)).toBeNull();
    expect(await storage.getObject(markdownKey)).toBeNull();
    expect(await queue.ingestJobStatus(id)).toBe('missing');
  });

  it('keeps a citing queries row, snapshot intact, with book_id nulled', async () => {
    const { id } = await insertBook();
    const citations = [
      {
        chunkId: randomUUID(),
        bookTitle: 'The Quiet Craft of Habit',
        chapterTitle: 'Chapter 1. Starting Small',
        chunkText: 'Small steps compound.',
      },
    ];
    const queryId = randomUUID();
    await db.pool.query(
      `INSERT INTO queries (id, user_id, question, answer, book_id, citations)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        queryId,
        userId,
        'How do habits form?',
        'Gradually.',
        id,
        JSON.stringify(citations),
      ],
    );

    await makeDeleteProcessor().process(id);

    const { rows } = await db.pool.query(
      `SELECT book_id, question, answer, citations FROM queries WHERE id = $1`,
      [queryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].book_id).toBeNull();
    expect(rows[0].question).toBe('How do habits form?');
    expect(rows[0].answer).toBe('Gradually.');
    expect(rows[0].citations).toEqual(citations);
  });

  it('is idempotent - a replayed delete job for a gone book is a no-op', async () => {
    const { id } = await insertBook();
    await makeDeleteProcessor().process(id);

    const outcome = await makeDeleteProcessor().process(id);
    expect(outcome).toEqual({ status: 'gone' });
  });

  it('removes a still-queued ingest job without waiting', async () => {
    const { id } = await insertBook();
    await db.pool.query(`UPDATE books SET status = 'deleting' WHERE id = $1`, [
      id,
    ]);
    await queue.enqueueIngest({ bookId: id });

    await makeDeleteProcessor().process(id);

    expect(await queue.ingestJobStatus(id)).toBe('missing');
    expect(queue.recorded.filter((j) => j.name === 'ingest')).toHaveLength(0);
  });
});
