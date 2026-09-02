import { randomUUID } from 'node:crypto';
import { createDbClient, type DbClient } from '@scriptorium/database/client';
import {
  FakeLlmClient,
  FakePdfExtractor,
  FakeObjectStorage,
  PdfExtractionError,
  type PdfExtractor,
} from '@scriptorium/providers';
import { IngestRepository } from '@scriptorium/server-core';
import { bookEventsChannel } from '@scriptorium/contracts';
import { IngestProcessor } from './ingest-processor.js';
import { StageEventPublisher } from './stage-event-publisher.js';
import { InMemoryEventTransport } from './event-transport.js';
import {
  setupTestDatabase,
  type TestDatabase,
} from '../test-support/test-database.js';

// Seam 2: the real pipeline (IngestProcessor + real stages) against a real
// Postgres, with the offline provider fakes and an in-memory event transport.
describe('ingest pipeline: extract + identifyBook (Seam 2)', () => {
  let db: TestDatabase;
  let client: DbClient;
  let repo: IngestRepository;
  let storage: FakeObjectStorage;
  let transport: InMemoryEventTransport;
  let userId: string;

  const PDF_BYTES = Buffer.from('%PDF-1.7 fake bytes');

  function makeProcessor(pdfExtractor: PdfExtractor = new FakePdfExtractor()) {
    const publisher = new StageEventPublisher(transport);
    return new IngestProcessor(
      repo,
      publisher,
      storage,
      pdfExtractor,
      new FakeLlmClient({ delayMs: 0 }),
    );
  }

  async function insertBook(overrides: Partial<{ title: string }> = {}) {
    const id = randomUUID();
    const s3Key = `books/${userId}/${randomUUID()}.pdf`;
    await db.pool.query(
      `INSERT INTO books (id, user_id, original_filename, s3_key, file_size_bytes, status, title)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [
        id,
        userId,
        'the-quiet-craft.pdf',
        s3Key,
        PDF_BYTES.length,
        overrides.title ?? null,
      ],
    );
    await storage.putObject(s3Key, PDF_BYTES, 'application/pdf');
    return { id, s3Key };
  }

  const readBook = (id: string) => repo.findById(id);

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
    transport = new InMemoryEventTransport();
    const [user] = (
      await db.pool.query(
        `INSERT INTO users (id, clerk_user_id, email)
         VALUES ($1, $2, $3) RETURNING id`,
        [randomUUID(), 'user_seam2', 'seam2@example.com'],
      )
    ).rows;
    userId = user.id;
  });

  it('advances pending -> extracting, stores markdown, records page count, and stops cleanly', async () => {
    const { id, s3Key } = await insertBook();

    const outcome = await makeProcessor().process(id);

    expect(outcome).toEqual({ status: 'completed', lastStage: 'identifyBook' });

    const book = await readBook(id);
    expect(book?.status).toBe('extracting');
    expect(book?.extractedMarkdownKey).toBe(s3Key.replace(/\.pdf$/, '.md'));
    expect(book?.pageCount).toBeGreaterThan(0);

    const markdownKey = book?.extractedMarkdownKey ?? '';
    const stored = await storage.getObject(markdownKey);
    expect(Buffer.from(stored as Uint8Array).toString()).toContain('# ');

    // identifyBook backfilled the title from the fixture's `#` heading.
    expect(book?.title).toBe('The Quiet Craft of Habit');

    const events = transport.eventsFor<{ type: string }>(bookEventsChannel(id));
    expect(events.map((e) => e.type)).toEqual([
      'stage_entered',
      'book_identified',
    ]);
    expect(events[0]).toMatchObject({ seq: 1, stage: 'extracting' });
    expect(events[1]).toMatchObject({
      seq: 2,
      title: 'The Quiet Craft of Habit',
    });
  });

  it('lands the book failed at extract on a terminal extractor error', async () => {
    const { id } = await insertBook();
    const brokenExtractor: PdfExtractor = {
      extract: () =>
        Promise.reject(new PdfExtractionError('PDF_IS_BROKEN', false)),
    };

    await expect(makeProcessor(brokenExtractor).process(id)).rejects.toThrow(
      /PDF_IS_BROKEN/,
    );

    const book = await readBook(id);
    expect(book?.status).toBe('failed');
    expect(book?.failedStage).toBe('extract');
    expect(book?.failureReason).toContain('PDF_IS_BROKEN');

    const events = transport.eventsFor<{ type: string }>(bookEventsChannel(id));
    expect(events.map((e) => e.type)).toContain('book_failed');
  });

  it('re-running skips a completed extract stage', async () => {
    const { id } = await insertBook();
    await makeProcessor().process(id);

    const first = await readBook(id);
    const markdownKey = first?.extractedMarkdownKey ?? '';
    expect(markdownKey).not.toBe('');

    // Wipe the stored blob; a re-run must NOT call extract again (it would
    // fail to find the original, which we also remove).
    storage.removeObject(markdownKey);
    const throwingExtractor: PdfExtractor = {
      extract: () => {
        throw new Error('extract should not have run');
      },
    };

    const outcome = await makeProcessor(throwingExtractor).process(id);
    expect(outcome.status).toBe('completed');
    const again = await readBook(id);
    expect(again?.extractedMarkdownKey).toBe(markdownKey);
  });

  it('skips identifyBook when a title override was supplied at upload', async () => {
    const { id } = await insertBook({ title: 'My Own Title' });

    await makeProcessor().process(id);

    const book = await readBook(id);
    expect(book?.title).toBe('My Own Title');
    const events = transport.eventsFor<{ type: string }>(bookEventsChannel(id));
    expect(events.map((e) => e.type)).not.toContain('book_identified');
  });

  it('returns cleanly without running stages when the book is deleting', async () => {
    const { id } = await insertBook();
    await db.pool.query(`UPDATE books SET status = 'deleting' WHERE id = $1`, [
      id,
    ]);

    const outcome = await makeProcessor().process(id);

    expect(outcome).toEqual({ status: 'aborted' });
    const book = await readBook(id);
    expect(book?.status).toBe('deleting');
    expect(book?.extractedMarkdownKey).toBeNull();
  });
});
