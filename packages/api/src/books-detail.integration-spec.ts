import type { INestApplication } from '@nestjs/common';
import {
  BookDetailDto,
  CreateUploadUrlResponse,
  PROBLEM_CONTENT_TYPE,
} from '@scriptorium/contracts';
import {
  FakeObjectStorage,
  FakeQueue,
  OBJECT_STORAGE,
  QUEUE,
} from '@scriptorium/providers';
import request from 'supertest';
import { createTestApp } from './test-support/create-test-app';
import {
  createTestAuthority,
  type TestAuthority,
} from './test-support/rsa-jwt';
import {
  setupTestDatabase,
  type TestDatabase,
} from './test-support/test-database';

// Seam 1: the real Nest app + real Postgres + locally-minted JWTs. Exercises
// `GET /books/:id` (detail shape, no chunks) and `PATCH /books/:id` (the
// title/author correction rules) end to end.
describe('read a book and correct its metadata (Seam 1)', () => {
  let db: TestDatabase;
  let auth: TestAuthority;
  let app: INestApplication;
  let storage: FakeObjectStorage;
  let queue: FakeQueue;

  const header = () =>
    auth.authHeaderFor({
      clerkUserId: 'user_alice',
      email: 'alice@example.com',
    });
  const bobHeader = () =>
    auth.authHeaderFor({ clerkUserId: 'user_bob', email: 'bob@example.com' });
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    db = await setupTestDatabase();
    auth = createTestAuthority();
    app = await createTestApp({ jwtKey: auth.jwtKey, databaseUrl: db.url });
    storage = app.get(OBJECT_STORAGE);
    queue = app.get(QUEUE);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
    storage.clear();
    queue.clear();
  });

  const validUploadBody = {
    filename: 'atomic-habits.pdf',
    contentType: 'application/pdf',
    fileSizeBytes: 1_234_567,
  };

  // Land a `pending` book through the real upload handoff and return its id.
  async function createBook(
    overrides: { title?: string; filename?: string } = {},
  ): Promise<string> {
    const url: CreateUploadUrlResponse = (
      await request(server())
        .post('/api/v1/books/upload-url')
        .set(header())
        .send(validUploadBody)
    ).body;
    storage.simulateUpload(url.s3Key, validUploadBody.fileSizeBytes);

    const created = await request(server())
      .post('/api/v1/books')
      .set(header())
      .send({
        s3Key: url.s3Key,
        originalFilename: overrides.filename ?? validUploadBody.filename,
        fileSizeBytes: validUploadBody.fileSizeBytes,
        ...(overrides.title ? { title: overrides.title } : {}),
      });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  describe('GET /books/:id', () => {
    it('returns the book with its summary and ordered chapters, never chunks', async () => {
      const id = await createBook();

      // Stand in for the ingest worker: a whole-book summary, two chapters
      // (inserted out of order), and a chunk under each.
      await db.pool.query(`UPDATE books SET summary = $1 WHERE id = $2`, [
        '# Overview\n\nThe core model of the book.',
        id,
      ]);
      const chapterTwo = await db.pool.query(
        `INSERT INTO chapters (book_id, chapter_index, title, summary)
         VALUES ($1, 1, 'Chapter 2', NULL) RETURNING id`,
        [id],
      );
      const chapterOne = await db.pool.query(
        `INSERT INTO chapters (book_id, chapter_index, title, page_start, page_end, summary)
         VALUES ($1, 0, 'Chapter 1', 1, 20, 'The first deep dive.') RETURNING id`,
        [id],
      );
      let chunkIndex = 0;
      for (const chapter of [chapterOne, chapterTwo]) {
        await db.pool.query(
          `INSERT INTO chunks (chapter_id, book_id, user_id, chunk_index, chunk_text, book_title, chapter_title)
           SELECT $1, $2, b.user_id, $3, 'chunk text', 'Atomic Habits', 'ch'
             FROM books b WHERE b.id = $2`,
          [chapter.rows[0].id, id, chunkIndex++],
        );
      }

      const res = await request(server())
        .get(`/api/v1/books/${id}`)
        .set(header());

      expect(res.status).toBe(200);
      expect(() => BookDetailDto.parse(res.body)).not.toThrow();
      expect(res.body.summary).toContain('The core model');
      expect(
        res.body.chapters.map((c: { chapterIndex: number }) => c.chapterIndex),
      ).toEqual([0, 1]);
      expect(res.body.chapters[0]).toMatchObject({
        title: 'Chapter 1',
        pageStart: 1,
        pageEnd: 20,
        summary: 'The first deep dive.',
      });
      expect(res.body.chapters[1].summary).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('chunk text');
      expect(JSON.stringify(res.body)).not.toContain('chunks');
    });

    it('returns null summary and an empty chapters array before ingest', async () => {
      const id = await createBook();
      const res = await request(server())
        .get(`/api/v1/books/${id}`)
        .set(header());
      expect(res.status).toBe(200);
      expect(res.body.summary).toBeNull();
      expect(res.body.chapters).toEqual([]);
    });

    it("is an identical 404 for an unknown id and for another user's book", async () => {
      const id = await createBook();

      const unknown = await request(server())
        .get('/api/v1/books/11111111-1111-4111-8111-111111111111')
        .set(header());
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('book_not_found');

      const notYours = await request(server())
        .get(`/api/v1/books/${id}`)
        .set(bobHeader());
      expect(notYours.status).toBe(404);
      expect(notYours.body.code).toBe('book_not_found');
    });
  });

  describe('PATCH /books/:id', () => {
    it('updates the title and returns the updated book', async () => {
      const id = await createBook();
      const res = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(header())
        .send({ title: 'Atomic Habits (2nd ed.)' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Atomic Habits (2nd ed.)');
    });

    it('clears the author on an explicit null', async () => {
      const id = await createBook();
      await db.pool.query(
        `UPDATE books SET author = 'Wrong Guess' WHERE id = $1`,
        [id],
      );

      const res = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(header())
        .send({ author: null });

      expect(res.status).toBe(200);
      expect(res.body.author).toBeNull();
    });

    it('rejects an empty patch with no_fields', async () => {
      const id = await createBook();
      const res = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(header())
        .send({});
      expect(res.status).toBe(422);
      expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
      expect(res.body.code).toBe('no_fields');
    });

    it('rejects a title over 500 chars with a schema 422', async () => {
      const id = await createBook();
      const res = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(header())
        .send({ title: 'x'.repeat(501) });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('validation_failed');
    });

    it('rejects a null title with a schema 422', async () => {
      const id = await createBook();
      const res = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(header())
        .send({ title: null });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('validation_failed');
    });

    it("is an identical 404 for another user's book, before any body check", async () => {
      const id = await createBook();

      const hijack = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(bobHeader())
        .send({ title: 'hijack' });
      expect(hijack.status).toBe(404);
      expect(hijack.body.code).toBe('book_not_found');

      // An empty patch to someone else's book is still a 404 - ownership is
      // checked before `no_fields`, so the error never reveals the id exists.
      const empty = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(bobHeader())
        .send({});
      expect(empty.status).toBe(404);
      expect(empty.body.code).toBe('book_not_found');
    });

    it('keeps a user-supplied title authoritative through create, GET and PATCH', async () => {
      // The worker-side suppression (`identifyBook.isComplete` short-circuits
      // on a non-null title, and the LLM guess never overwrites a set column)
      // is a Seam 2 concern; here we pin the API-observable half: a title the
      // reader supplies on `POST /books` is what `GET` returns and what a
      // later `PATCH` replaces - the pipeline never gets to clobber it.
      const id = await createBook({ title: 'Reader Chosen Title' });
      const detail = await request(server())
        .get(`/api/v1/books/${id}`)
        .set(header());
      expect(detail.body.title).toBe('Reader Chosen Title');

      const patched = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(header())
        .send({ title: 'Reader Corrected Title' });
      expect(patched.body.title).toBe('Reader Corrected Title');
    });
  });
});
