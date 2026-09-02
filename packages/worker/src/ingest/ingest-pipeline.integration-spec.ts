import { randomUUID } from 'node:crypto';
import { createDbClient, type DbClient } from '@scriptorium/database/client';
import {
  FakeEmbeddingClient,
  FakeLlmClient,
  FakePdfExtractor,
  FakeObjectStorage,
  PdfExtractionError,
  type EmbeddingClient,
  type LlmClient,
  type LlmRequest,
  type PdfExtractor,
} from '@scriptorium/providers';
import { IngestRepository } from '@scriptorium/server-core';
import { bookEventsChannel } from '@scriptorium/contracts';
import { IngestProcessor } from './ingest-processor.js';
import { StageEventPublisher } from './stage-event-publisher.js';
import { InMemoryEventTransport } from './event-transport.js';
import { TerminalIngestError } from './errors.js';
import {
  setupTestDatabase,
  type TestDatabase,
} from '../test-support/test-database.js';

// Seam 2: the real pipeline (IngestProcessor + real stages) against a real
// Postgres, with the offline provider fakes and an in-memory event transport.
describe('ingest pipeline (Seam 2)', () => {
  let db: TestDatabase;
  let client: DbClient;
  let repo: IngestRepository;
  let storage: FakeObjectStorage;
  let transport: InMemoryEventTransport;
  let userId: string;

  const PDF_BYTES = Buffer.from('%PDF-1.7 fake bytes');

  function makeProcessor(
    opts: {
      pdfExtractor?: PdfExtractor;
      llm?: LlmClient;
      embeddings?: EmbeddingClient;
    } = {},
  ) {
    const publisher = new StageEventPublisher(transport);
    return new IngestProcessor(
      repo,
      publisher,
      storage,
      opts.pdfExtractor ?? new FakePdfExtractor(),
      opts.llm ?? new FakeLlmClient({ delayMs: 0 }),
      opts.embeddings ?? new FakeEmbeddingClient(),
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
  const eventTypes = (id: string) =>
    transport
      .eventsFor<{ type: string }>(bookEventsChannel(id))
      .map((e) => e.type);

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

  it('runs an uploaded book all the way to ready with every summary populated', async () => {
    const { id } = await insertBook();

    const outcome = await makeProcessor().process(id);
    expect(outcome).toEqual({ status: 'completed', lastStage: 'bookSummary' });

    const book = await readBook(id);
    expect(book?.status).toBe('ready');
    expect(book?.summary).toBeTruthy();
    expect(book?.summaryGeneratedAt).toBeInstanceOf(Date);

    const chunks = await db.pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE embedding IS NULL)::int AS unembedded
         FROM chunks WHERE book_id = $1`,
      [id],
    );
    expect(chunks.rows[0].total).toBeGreaterThan(0);
    expect(chunks.rows[0].unembedded).toBe(0);

    const chapters = await db.pool.query(
      `SELECT title, summary FROM chapters WHERE book_id = $1 ORDER BY chapter_index`,
      [id],
    );
    expect(chapters.rowCount).toBe(7);
    expect(
      chapters.rows.every((r) => (r.summary ?? '').trim().length > 0),
    ).toBe(true);

    const types = eventTypes(id);
    expect(types).toContain('book_completed');
    expect(types.filter((t) => t === 'stage_entered').length).toBe(4); // extract, chunk, embed, summarize
    const progress = transport
      .eventsFor<{ type: string; stage: string; unit: string }>(
        bookEventsChannel(id),
      )
      .filter((e) => e.type === 'stage_progress');
    expect(progress.some((e) => e.unit === 'chunks')).toBe(true);
    expect(progress.some((e) => e.unit === 'chapters')).toBe(true);
  });

  it('re-running a ready book is a no-op walk that does not re-emit completion', async () => {
    const { id } = await insertBook();
    await makeProcessor().process(id);
    transport.clear();

    const spyLlm = new FakeLlmClient({ delayMs: 0 });
    const complete = jest.spyOn(spyLlm, 'complete');
    const outcome = await makeProcessor({ llm: spyLlm }).process(id);

    expect(outcome.status).toBe('completed');
    expect(complete).not.toHaveBeenCalled();
    expect(eventTypes(id)).not.toContain('book_completed');
  });

  it('resumes only the unembedded chunks after a mid-embed crash', async () => {
    const { id } = await insertBook();
    await makeProcessor().process(id);

    // Simulate a crash partway through embed: wipe half the vectors.
    await db.pool.query(
      `UPDATE chunks SET embedding = NULL
         WHERE id IN (
           SELECT id FROM chunks WHERE book_id = $1
           ORDER BY chunk_index
           LIMIT (SELECT ceil(count(*)/2.0) FROM chunks WHERE book_id = $1)
         )`,
      [id],
    );
    await db.pool.query(`UPDATE books SET status = 'embedding' WHERE id = $1`, [
      id,
    ]);
    const cleared = await db.pool.query(
      `SELECT count(*)::int AS n FROM chunks WHERE book_id = $1 AND embedding IS NULL`,
      [id],
    );
    expect(cleared.rows[0].n).toBeGreaterThan(0);

    const embeddings = new FakeEmbeddingClient();
    const embed = jest.spyOn(embeddings, 'embed');
    await makeProcessor({ embeddings }).process(id);

    const embeddedTexts = embed.mock.calls.flatMap(([texts]) => texts);
    expect(embeddedTexts.length).toBe(cleared.rows[0].n);
    const still = await db.pool.query(
      `SELECT count(*)::int AS n FROM chunks WHERE book_id = $1 AND embedding IS NULL`,
      [id],
    );
    expect(still.rows[0].n).toBe(0);
    expect((await readBook(id))?.status).toBe('ready');
  });

  it('resumes only the chapters still missing a summary after a mid-chapterSummary crash', async () => {
    const { id } = await insertBook();
    await makeProcessor().process(id);

    const [target] = (
      await db.pool.query(
        `SELECT id FROM chapters WHERE book_id = $1 ORDER BY chapter_index LIMIT 1`,
        [id],
      )
    ).rows;
    await db.pool.query(`UPDATE chapters SET summary = NULL WHERE id = $1`, [
      target.id,
    ]);
    await db.pool.query(
      `UPDATE books SET summary = NULL, summary_generated_at = NULL, status = 'summarizing' WHERE id = $1`,
      [id],
    );

    const spyLlm = new FakeLlmClient({ delayMs: 0 });
    const complete = jest.spyOn(spyLlm, 'complete');
    await makeProcessor({ llm: spyLlm }).process(id);

    // One chapter deep-dive + one whole-book reduce.
    expect(complete).toHaveBeenCalledTimes(2);
    const book = await readBook(id);
    expect(book?.status).toBe('ready');
    expect(book?.summary).toBeTruthy();
    const missing = await db.pool.query(
      `SELECT count(*)::int AS n FROM chapters WHERE book_id = $1 AND summary IS NULL`,
      [id],
    );
    expect(missing.rows[0].n).toBe(0);
  });

  it('fails the book when one chapter permanently fails to summarise', async () => {
    const { id } = await insertBook();

    const fallback = new FakeLlmClient({ delayMs: 0 });
    const llm: LlmClient = {
      complete: (request: LlmRequest) => {
        const content = String(request.messages[0]?.content ?? '');
        if (content.startsWith('Chapter: Chapter 1. Starting Small')) {
          return Promise.reject(new TerminalIngestError('chapter blew up'));
        }
        return fallback.complete(request);
      },
      stream: () => {
        throw new Error('unused');
      },
    };

    await expect(makeProcessor({ llm }).process(id)).rejects.toThrow(
      /chapter blew up/,
    );

    const book = await readBook(id);
    expect(book?.status).toBe('failed');
    expect(book?.failedStage).toBe('chapterSummary');
    expect(eventTypes(id)).toContain('book_failed');
  });

  it('lands the book failed at extract on a terminal extractor error', async () => {
    const { id } = await insertBook();
    const brokenExtractor: PdfExtractor = {
      extract: () =>
        Promise.reject(new PdfExtractionError('PDF_IS_BROKEN', false)),
    };

    await expect(
      makeProcessor({ pdfExtractor: brokenExtractor }).process(id),
    ).rejects.toThrow(/PDF_IS_BROKEN/);

    const book = await readBook(id);
    expect(book?.status).toBe('failed');
    expect(book?.failedStage).toBe('extract');
    expect(eventTypes(id)).toContain('book_failed');
  });

  it('backfills the title and keeps a user-supplied title', async () => {
    const { id } = await insertBook();
    await makeProcessor().process(id);
    expect((await readBook(id))?.title).toBe('The Quiet Craft of Habit');

    const override = await insertBook({ title: 'My Own Title' });
    await makeProcessor().process(override.id);
    expect((await readBook(override.id))?.title).toBe('My Own Title');
    expect(eventTypes(override.id)).not.toContain('book_identified');
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

  it('detects the fixture chapters and writes contiguous chunks', async () => {
    const { id } = await insertBook();
    await makeProcessor().process(id);

    const chapterRows = await db.pool.query(
      `SELECT chapter_index, title, page_start, page_end
         FROM chapters WHERE book_id = $1 ORDER BY chapter_index`,
      [id],
    );
    expect(chapterRows.rowCount).toBe(7);
    expect(chapterRows.rows[0]).toMatchObject({
      chapter_index: 0,
      title: 'Chapter 1. Starting Small',
    });
    expect(chapterRows.rows.every((r) => r.page_start <= r.page_end)).toBe(
      true,
    );

    const chunkRows = await db.pool.query(
      `SELECT chunk_index, book_title FROM chunks WHERE book_id = $1 ORDER BY chunk_index`,
      [id],
    );
    expect(chunkRows.rowCount).toBeGreaterThan(0);
    expect(
      chunkRows.rows.every((r) => r.book_title === 'The Quiet Craft of Habit'),
    ).toBe(true);
    expect(chunkRows.rows.map((r) => r.chunk_index)).toEqual(
      chunkRows.rows.map((_, i) => i),
    );
  });

  it('re-running skips a completed extract stage', async () => {
    const { id } = await insertBook();
    await makeProcessor().process(id);

    const first = await readBook(id);
    const markdownKey = first?.extractedMarkdownKey ?? '';
    storage.removeObject(markdownKey);
    const throwingExtractor: PdfExtractor = {
      extract: () => {
        throw new Error('extract should not have run');
      },
    };

    const outcome = await makeProcessor({
      pdfExtractor: throwingExtractor,
    }).process(id);
    expect(outcome.status).toBe('completed');
    expect((await readBook(id))?.extractedMarkdownKey).toBe(markdownKey);
  });
});
