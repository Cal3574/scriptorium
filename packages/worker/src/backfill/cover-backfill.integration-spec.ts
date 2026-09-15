import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { createDbClient, type DbClient } from '@scriptorium/database/client';
import { FakeObjectStorage } from '@scriptorium/providers';
import { BooksRepository } from '@scriptorium/server-core';
import { CoverBackfillService } from './cover-backfill.service.js';
import {
  setupTestDatabase,
  type TestDatabase,
} from '../test-support/test-database.js';

// Seam 2: the real `CoverBackfillService` + real `BooksRepository` against a
// real Postgres, with `FakeObjectStorage` standing in for S3 - the same shape
// as `ingest-pipeline.integration-spec.ts`.
describe('cover backfill (Seam 2)', () => {
  let db: TestDatabase;
  let client: DbClient;
  let repo: BooksRepository;
  let storage: FakeObjectStorage;
  let service: CoverBackfillService;
  let userId: string;

  async function realPdfBytes(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.addPage([300, 450]);
    return Buffer.from(await doc.save());
  }

  async function insertBook(
    overrides: {
      s3Key?: string;
      coverImageUrl?: string;
      status?: string;
    } = {},
  ) {
    const id = randomUUID();
    const s3Key = overrides.s3Key ?? `books/${userId}/${randomUUID()}.pdf`;
    await db.pool.query(
      `INSERT INTO books (id, user_id, original_filename, s3_key, file_size_bytes, status, cover_image_url)
       VALUES ($1, $2, 'book.pdf', $3, 1000, $4, $5)`,
      [
        id,
        userId,
        s3Key,
        overrides.status ?? 'ready',
        overrides.coverImageUrl ?? null,
      ],
    );
    return { id, s3Key };
  }

  const coverOf = async (id: string) => {
    const { rows } = await db.pool.query(
      `SELECT cover_image_url FROM books WHERE id = $1`,
      [id],
    );
    return rows[0]?.cover_image_url as string | null;
  };

  beforeAll(async () => {
    db = await setupTestDatabase();
    client = createDbClient(db.url);
    repo = new BooksRepository(client);
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
    service = new CoverBackfillService(repo, storage);

    const [user] = (
      await db.pool.query(
        `INSERT INTO users (id, clerk_user_id, email)
         VALUES ($1, $2, $3) RETURNING id`,
        [randomUUID(), 'user_seam2_covers', 'seam2-covers@example.com'],
      )
    ).rows;
    userId = user.id;
  });

  it('renders and stores a cover for a book missing one', async () => {
    const pdf = await realPdfBytes();
    const { id, s3Key } = await insertBook();
    await storage.putObject(s3Key, pdf, 'application/pdf');

    const result = await service.run();

    expect(result).toEqual({ processed: 1, updated: 1, skipped: 0 });
    expect(await coverOf(id)).toMatch(/^data:image\/png;base64,/);
  });

  it('never re-touches a book that already has a cover', async () => {
    await insertBook({ coverImageUrl: 'data:image/png;base64,already' });

    const result = await service.run();

    expect(result).toEqual({ processed: 0, updated: 0, skipped: 0 });
  });

  it('skips (without looping forever) a book whose PDF is missing from storage', async () => {
    const { id } = await insertBook();
    // No `storage.putObject` call: the s3Key was never landed.

    const result = await service.run();

    expect(result).toEqual({ processed: 1, updated: 0, skipped: 1 });
    expect(await coverOf(id)).toBeNull();
  });

  it('skips (without looping forever) a book whose PDF is not renderable', async () => {
    const { id, s3Key } = await insertBook();
    await storage.putObject(s3Key, Buffer.from('not a pdf'), 'application/pdf');

    const result = await service.run();

    expect(result).toEqual({ processed: 1, updated: 0, skipped: 1 });
    expect(await coverOf(id)).toBeNull();
  });

  it('never touches a book mid-delete', async () => {
    await insertBook({ status: 'deleting' });

    const result = await service.run();

    expect(result).toEqual({ processed: 0, updated: 0, skipped: 0 });
  });

  it('processes more than one batch in a single run', async () => {
    const pdf = await realPdfBytes();
    const books = await Promise.all(
      Array.from({ length: 30 }, async () => {
        const book = await insertBook();
        await storage.putObject(book.s3Key, pdf, 'application/pdf');
        return book;
      }),
    );

    const result = await service.run();

    expect(result).toEqual({ processed: 30, updated: 30, skipped: 0 });
    for (const { id } of books) {
      expect(await coverOf(id)).toMatch(/^data:image\/png;base64,/);
    }
  });

  it('a mixed batch updates the renderable books and skips the rest', async () => {
    const pdf = await realPdfBytes();
    const good = await insertBook();
    await storage.putObject(good.s3Key, pdf, 'application/pdf');
    const missing = await insertBook();
    const corrupt = await insertBook();
    await storage.putObject(
      corrupt.s3Key,
      Buffer.from('garbage'),
      'application/pdf',
    );

    const result = await service.run();

    expect(result).toEqual({ processed: 3, updated: 1, skipped: 2 });
    expect(await coverOf(good.id)).toMatch(/^data:image\/png;base64,/);
    expect(await coverOf(missing.id)).toBeNull();
    expect(await coverOf(corrupt.id)).toBeNull();
  });
});
