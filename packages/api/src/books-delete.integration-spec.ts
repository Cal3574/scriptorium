import type { INestApplication } from '@nestjs/common';
import {
  FakeObjectStorage,
  FakeQueue,
  OBJECT_STORAGE,
  QUEUE,
} from '@scriptorium/providers';
import request from 'supertest';
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

// Seam 1: `DELETE /api/v1/books/:id` against the real Nest app + real Postgres,
// with the fake queue so we can assert the enqueued delete job.
describe('delete a book (Seam 1)', () => {
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
    filename: 'the-pragmatic-programmer.pdf',
    contentType: 'application/pdf',
    fileSizeBytes: 4096,
  };

  async function createBook(): Promise<string> {
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
      });
    return created.body.id as string;
  }

  const statusOf = async (id: string) =>
    (await db.pool.query(`SELECT status FROM books WHERE id = $1`, [id]))
      .rows[0]?.status;

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

  it('flips the book to deleting, enqueues one delete job, and returns 202 with an empty body', async () => {
    const id = await createBook();
    queue.clear(); // drop the ingest enqueue from creation

    const res = await request(server())
      .delete(`/api/v1/books/${id}`)
      .set(alice());

    expect(res.status).toBe(202);
    expect(res.body).toEqual({});
    expect(res.text).toBe('');

    expect(await statusOf(id)).toBe('deleting');
    expect(queue.recorded).toEqual([
      expect.objectContaining({
        name: 'delete',
        jobId: `delete:${id}`,
      }),
    ]);
    expect((queue.recorded[0].data as { bookId: string }).bookId).toBe(id);
  });

  it('stays a 202 for a book already deleting and re-drives the delete', async () => {
    const id = await createBook();
    await request(server()).delete(`/api/v1/books/${id}`).set(alice());

    const res = await request(server())
      .delete(`/api/v1/books/${id}`)
      .set(alice());

    expect(res.status).toBe(202);
    expect(await statusOf(id)).toBe('deleting');
    // The repeat call re-enqueues; the queue de-dupes on the delete jobId so
    // there is still exactly one delete job.
    expect(queue.recorded.filter((j) => j.name === 'delete')).toHaveLength(1);
  });

  it('answers an unknown id with a 404 book_not_found', async () => {
    const res = await request(server())
      .delete('/api/v1/books/11111111-1111-4111-8111-111111111111')
      .set(alice());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('book_not_found');
  });

  it("answers another user's book with an identical 404", async () => {
    const id = await createBook();
    const res = await request(server())
      .delete(`/api/v1/books/${id}`)
      .set(bob());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('book_not_found');
    expect(await statusOf(id)).not.toBe('deleting');
  });
});
