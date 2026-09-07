import type { INestApplication } from '@nestjs/common';
import { PROBLEM_CONTENT_TYPE } from '@scriptorium/contracts';
import {
  FakeObjectStorage,
  OBJECT_STORAGE,
} from '@scriptorium/providers';
import type { PlanLimits } from '@scriptorium/server-core';
import request from 'supertest';
import { createTestApp } from './test-support/create-test-app';
import { createTestAuthority, type TestAuthority } from './test-support/rsa-jwt';
import {
  setupTestDatabase,
  type TestDatabase,
} from './test-support/test-database';

// Seam 1: the `@Quota('books')` guard over the real Nest app + Postgres, booted
// with tiny plan limits so the ceiling is reached in two rows, not fifty.
describe('book quota enforcement (Seam 1)', () => {
  let db: TestDatabase;
  let auth: TestAuthority;
  let app: INestApplication;
  let storage: FakeObjectStorage;

  // free books = 2 (the shipped Free number), pro books = 3 (tiny stand-in for
  // 50, enough to prove the higher ceiling applies).
  const planLimits: PlanLimits = {
    free: { books: 2, queries: 2 },
    pro: { books: 3, queries: 3 },
  };

  beforeAll(async () => {
    db = await setupTestDatabase();
    auth = createTestAuthority();
    app = await createTestApp({
      jwtKey: auth.jwtKey,
      databaseUrl: db.url,
      planLimits,
    });
    storage = app.get(OBJECT_STORAGE);
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
    storage.clear();
  });

  const server = () => app.getHttpServer();

  const freeHeader = (id = 'user_free') =>
    auth.authHeaderFor(
      { clerkUserId: id, email: `${id}@example.com` },
      { plan: 'free' },
    );
  const proHeader = (id = 'user_pro') =>
    auth.authHeaderFor(
      { clerkUserId: id, email: `${id}@example.com` },
      { plan: 'pro' },
    );

  // Run the full upload handoff and return the `POST /books` response.
  async function createBook(
    header: { Authorization: string },
    name = 'book.pdf',
  ): Promise<request.Response> {
    const size = 4096;
    const urlRes = await request(server())
      .post('/api/v1/books/upload-url')
      .set(header)
      .send({ filename: name, contentType: 'application/pdf', fileSizeBytes: size })
      .expect(201);
    storage.simulateUpload(urlRes.body.s3Key, size);
    return request(server()).post('/api/v1/books').set(header).send({
      s3Key: urlRes.body.s3Key,
      originalFilename: name,
      fileSizeBytes: size,
    });
  }

  async function bookCount(userId: string): Promise<number> {
    const { rows } = await db.pool.query(
      'SELECT count(*)::int AS n FROM books WHERE user_id = $1',
      [userId],
    );
    return rows[0].n;
  }

  async function userId(header: { Authorization: string }): Promise<string> {
    const me = await request(server()).get('/api/v1/me').set(header).expect(200);
    return me.body.id;
  }

  // Insert `n` books straight into the table, bypassing the guard - stands in
  // for rows a reader accumulated on Pro before downgrading.
  async function seedBooks(uid: string, n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const { rows } = await db.pool.query(
        `INSERT INTO books (user_id, original_filename, s3_key, status)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [uid, `seed-${i}.pdf`, `books/${uid}/seed-${i}.pdf`, 'ready'],
      );
      ids.push(rows[0].id);
    }
    return ids;
  }

  it('lets a Free reader reach the limit, then returns 402 with no row written', async () => {
    const header = freeHeader();
    const uid = await userId(header);

    expect((await createBook(header, 'one.pdf')).status).toBe(201);
    expect((await createBook(header, 'two.pdf')).status).toBe(201);

    const blocked = await createBook(header, 'three.pdf');
    expect(blocked.status).toBe(402);
    expect(blocked.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(blocked.body.code).toBe('book_limit_reached');
    expect(await bookCount(uid)).toBe(2);
  });

  it('applies the higher Pro ceiling', async () => {
    const header = proHeader();
    expect((await createBook(header, '1.pdf')).status).toBe(201);
    expect((await createBook(header, '2.pdf')).status).toBe(201);
    expect((await createBook(header, '3.pdf')).status).toBe(201);
    expect((await createBook(header, '4.pdf')).status).toBe(402);
  });

  it('treats a token with no plan claim as Free', async () => {
    const header = auth.authHeaderFor({
      clerkUserId: 'user_noplan',
      email: 'noplan@example.com',
    });
    expect((await createBook(header, '1.pdf')).status).toBe(201);
    expect((await createBook(header, '2.pdf')).status).toBe(201);
    expect((await createBook(header, '3.pdf')).status).toBe(402);
  });

  it('does not quota-guard the presigned-URL step', async () => {
    const header = freeHeader();
    await createBook(header, '1.pdf');
    await createBook(header, '2.pdf');

    const res = await request(server())
      .post('/api/v1/books/upload-url')
      .set(header)
      .send({
        filename: 'x.pdf',
        contentType: 'application/pdf',
        fileSizeBytes: 4096,
      });
    expect(res.status).toBe(201);
  });

  it('rejects a no-token POST /books with 401, not the quota 500 path', async () => {
    const res = await request(server()).post('/api/v1/books').send({});
    expect(res.status).toBe(401);
  });

  describe('downgrade grace: a former Pro reader holding 3 books on Free', () => {
    let header: { Authorization: string };
    let uid: string;
    let seeded: string[];

    beforeEach(async () => {
      header = freeHeader('user_downgraded');
      uid = await userId(header);
      seeded = await seedBooks(uid, 3);
    });

    it('blocks a new upload', async () => {
      const res = await createBook(header, 'new.pdf');
      expect(res.status).toBe(402);
      expect(res.body.code).toBe('book_limit_reached');
      expect(await bookCount(uid)).toBe(3);
    });

    it('still lists every existing book', async () => {
      const res = await request(server()).get('/api/v1/books').set(header);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });

    it('still opens an existing book', async () => {
      const res = await request(server())
        .get(`/api/v1/books/${seeded[0]}`)
        .set(header);
      expect(res.status).toBe(200);
    });

    it('still retries a failed book', async () => {
      await db.pool.query("UPDATE books SET status = 'failed' WHERE id = $1", [
        seeded[0],
      ]);
      const res = await request(server())
        .post(`/api/v1/books/${seeded[0]}/retry`)
        .set(header);
      expect(res.status).toBe(201);
    });

    it('still lets the reader query', async () => {
      const res = await request(server())
        .get('/api/v1/queries')
        .set(header);
      expect(res.status).toBe(200);
    });
  });
});
