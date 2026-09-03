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

// Seam 1: `POST /api/v1/books/:id/retry` against the real Nest app + real
// Postgres, with the fake queue so we can assert the re-enqueued ingest job.
describe('retry a failed book (Seam 1)', () => {
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

  async function markFailed(id: string, stage = 'embed'): Promise<void> {
    await db.pool.query(
      `UPDATE books
          SET status = 'failed', failed_stage = $2, failure_reason = $3
        WHERE id = $1`,
      [id, stage, 'provider returned 500'],
    );
  }

  const rowOf = async (id: string) =>
    (
      await db.pool.query(
        `SELECT status, failed_stage, failure_reason FROM books WHERE id = $1`,
        [id],
      )
    ).rows[0];

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

  it('clears the failure, sets pending, re-enqueues ingest, and returns the book', async () => {
    const id = await createBook();
    await markFailed(id);
    queue.clear(); // drop the ingest enqueue from creation

    const res = await request(server())
      .post(`/api/v1/books/${id}/retry`)
      .set(alice());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id,
      status: 'pending',
      failedStage: null,
      failureReason: null,
    });

    expect(await rowOf(id)).toEqual({
      status: 'pending',
      failed_stage: null,
      failure_reason: null,
    });
    expect(queue.recorded).toEqual([
      expect.objectContaining({ name: 'ingest', jobId: id }),
    ]);
  });

  it('re-enqueues even when the previous ingest job has finished', async () => {
    const id = await createBook();
    await markFailed(id);
    queue.setIngestJobState(id, 'failed');

    await request(server()).post(`/api/v1/books/${id}/retry`).set(alice());

    expect(await queue.ingestJobStatus(id)).toBe('waiting');
    expect(queue.recorded.filter((j) => j.name === 'ingest')).toHaveLength(1);
  });

  it('rejects a retry from a non-failed status with 409 book_not_failed', async () => {
    const id = await createBook();

    const res = await request(server())
      .post(`/api/v1/books/${id}/retry`)
      .set(alice());

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('book_not_failed');
    expect((await rowOf(id)).status).toBe('pending');
  });

  it('is idempotent under a double retry - the second is 409', async () => {
    const id = await createBook();
    await markFailed(id);

    const first = await request(server())
      .post(`/api/v1/books/${id}/retry`)
      .set(alice());
    const second = await request(server())
      .post(`/api/v1/books/${id}/retry`)
      .set(alice());

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('book_not_failed');
  });

  it('answers an unknown id with a 404 book_not_found', async () => {
    const res = await request(server())
      .post('/api/v1/books/11111111-1111-4111-8111-111111111111/retry')
      .set(alice());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('book_not_found');
  });

  it("answers another user's failed book with an identical 404", async () => {
    const id = await createBook();
    await markFailed(id);

    const res = await request(server())
      .post(`/api/v1/books/${id}/retry`)
      .set(bob());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('book_not_found');
    expect((await rowOf(id)).status).toBe('failed');
  });
});
