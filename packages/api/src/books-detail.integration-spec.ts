import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  FakeObjectStorage,
  FakeQueue,
  OBJECT_STORAGE,
  QUEUE,
} from '@scriptorium/providers';
import request from 'supertest';
import { DB, IngestRepository } from '@scriptorium/server-core';
import type { CreateUploadUrlResponse } from '@scriptorium/contracts';
import { createTestApp } from './test-support/create-test-app';
import {
  createTestAuthority,
  type TestAuthority,
} from './test-support/rsa-jwt';
import {
  setupTestDatabase,
  type TestDatabase,
} from './test-support/test-database';

// Seam 1: `GET /api/v1/books/:id` and `PATCH /api/v1/books/:id` against the
// real Nest app + real Postgres, with the fake storage/queue.
describe('read and correct a book (Seam 1)', () => {
  let db: TestDatabase;
  let auth: TestAuthority;
  let app: INestApplication;
  let storage: FakeObjectStorage;
  let queue: FakeQueue;

  const alice = () =>
    auth.authHeaderFor({
      clerkUserId: 'user_alice',
      email: 'alice@example.com',
    });
  const bob = () =>
    auth.authHeaderFor({ clerkUserId: 'user_bob', email: 'bob@example.com' });
  const server = () => app.getHttpServer();

  const validUploadBody = {
    filename: 'atomic-habits.pdf',
    contentType: 'application/pdf',
    fileSizeBytes: 4096,
  };

  async function createBook(
    body: Record<string, unknown> = {},
  ): Promise<string> {
    const url: CreateUploadUrlResponse = (
      await request(server())
        .post('/api/v1/books/upload-url')
        .set(alice())
        .send(validUploadBody)
    ).body;
    storage.simulateUpload(url.s3Key, validUploadBody.fileSizeBytes);
    const created = await request(server())
      .post('/api/v1/books')
      .set(alice())
      .send({
        s3Key: url.s3Key,
        originalFilename: validUploadBody.filename,
        fileSizeBytes: validUploadBody.fileSizeBytes,
        ...body,
      });
    return created.body.id as string;
  }

  const rowOf = async (id: string) =>
    (
      await db.pool.query(
        `SELECT title, author, summary, status FROM books WHERE id = $1`,
        [id],
      )
    ).rows[0];

  async function seedSummaryAndChapters(bookId: string) {
    await db.pool.query(
      `UPDATE books SET summary = 'The whole-book summary.' WHERE id = $1`,
      [bookId],
    );
    // Insert out of index order to prove the endpoint orders by chapter_index.
    await db.pool.query(
      `INSERT INTO chapters (id, book_id, chapter_index, title, page_start, page_end, summary)
       VALUES
         ($1, $4, 1, 'Chapter Two', 20, 39, NULL),
         ($2, $4, 0, 'Chapter One', 1, 19, 'Deep dive on chapter one.'),
         ($3, $4, 2, NULL, NULL, NULL, NULL)`,
      [randomUUID(), randomUUID(), randomUUID(), bookId],
    );
  }

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

  describe('GET /books/:id', () => {
    it('returns the book summary and chapters ordered by chapterIndex, with no chunk data', async () => {
      const id = await createBook();
      await seedSummaryAndChapters(id);

      const res = await request(server())
        .get(`/api/v1/books/${id}`)
        .set(alice());

      expect(res.status).toBe(200);
      expect(res.body.summary).toBe('The whole-book summary.');
      expect(
        res.body.chapters.map((c: { title: string | null }) => c.title),
      ).toEqual(['Chapter One', 'Chapter Two', null]);
      expect(
        res.body.chapters.map((c: { chapterIndex: number }) => c.chapterIndex),
      ).toEqual([0, 1, 2]);
      expect(res.body.chapters[0].summary).toBe('Deep dive on chapter one.');
      expect(res.body.chapters[1].summary).toBeNull();

      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toContain('chunk');
      expect(serialised).not.toContain('embedding');
      for (const chapter of res.body.chapters) {
        expect(chapter).not.toHaveProperty('chunks');
        expect(chapter).not.toHaveProperty('bookId');
      }
    });

    it('returns null summary and an empty chapters array before the pipeline has run', async () => {
      const id = await createBook();
      const res = await request(server())
        .get(`/api/v1/books/${id}`)
        .set(alice());

      expect(res.status).toBe(200);
      expect(res.body.summary).toBeNull();
      expect(res.body.chapters).toEqual([]);
    });

    it('answers an unknown id with a 404 book_not_found', async () => {
      const res = await request(server())
        .get('/api/v1/books/11111111-1111-4111-8111-111111111111')
        .set(alice());
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('book_not_found');
    });

    it("answers another user's book with an identical 404", async () => {
      const id = await createBook();
      const res = await request(server()).get(`/api/v1/books/${id}`).set(bob());
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('book_not_found');
    });

    it('answers a malformed id with a 400, not a 500', async () => {
      const res = await request(server())
        .get('/api/v1/books/not-a-uuid')
        .set(alice());
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /books/:id', () => {
    it('updates the title and returns the full book', async () => {
      const id = await createBook();
      const res = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(alice())
        .send({ title: 'Atomic Habits' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Atomic Habits');
      expect((await rowOf(id)).title).toBe('Atomic Habits');
    });

    it('clears the author on an explicit null', async () => {
      const id = await createBook();
      await db.pool.query(
        `UPDATE books SET author = 'Wrong Guess' WHERE id = $1`,
        [id],
      );

      const res = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(alice())
        .send({ author: null });

      expect(res.status).toBe(200);
      expect(res.body.author).toBeNull();
      expect((await rowOf(id)).author).toBeNull();
    });

    it('rejects an empty body with 400 no_fields', async () => {
      const id = await createBook();
      const res = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(alice())
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('no_fields');
    });

    it('rejects a title over 500 chars with a schema 422', async () => {
      const id = await createBook();
      const res = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(alice())
        .send({ title: 'a'.repeat(501) });
      expect(res.status).toBe(422);
    });

    it('rejects a null title with a schema 422', async () => {
      const id = await createBook();
      const res = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(alice())
        .send({ title: null });
      expect(res.status).toBe(422);
    });

    it("answers another user's book with an identical 404", async () => {
      const id = await createBook();
      const res = await request(server())
        .patch(`/api/v1/books/${id}`)
        .set(bob())
        .send({ title: 'Nope' });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('book_not_found');
    });

    it('a user-set title is authoritative: recordIdentification leaves it untouched', async () => {
      // A user title supplied on POST /books must satisfy the identify
      // completeness check and never be overwritten by the LLM guess.
      const id = await createBook({ title: 'User Chosen Title' });

      // Replay the identify stage's write path against the real repository
      // (the worker's `IngestRepository`, wired to the same test Postgres).
      const repo = new IngestRepository(app.get(DB));
      const written = await repo.recordIdentification(id, {
        title: 'LLM Guessed Title',
        author: 'LLM Guessed Author',
      });

      // Only the still-null author is filled; the user title is kept.
      expect(written).toBe(true);
      const row = await rowOf(id);
      expect(row.title).toBe('User Chosen Title');
      expect(row.author).toBe('LLM Guessed Author');
    });
  });
});
