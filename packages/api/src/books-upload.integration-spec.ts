import type { INestApplication } from '@nestjs/common';
import {
  BookListItemDto,
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

// Seam 1: the real Nest app + real Postgres + locally-minted JWTs, with the
// fake object storage and fake queue so the browser -> S3 -> API handoff runs
// entirely offline.
describe('upload a book to the library (Seam 1)', () => {
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

  async function requestUploadUrl(
    body: Record<string, unknown>,
  ): Promise<request.Response> {
    return request(server())
      .post('/api/v1/books/upload-url')
      .set(header())
      .send(body);
  }

  const validUploadBody = {
    filename: 'the-pragmatic-programmer.pdf',
    contentType: 'application/pdf',
    fileSizeBytes: 2_504_646,
  };

  describe('POST /books/upload-url', () => {
    it('rejects a non-PDF content type with not_a_pdf', async () => {
      const res = await requestUploadUrl({
        ...validUploadBody,
        contentType: 'image/png',
      });
      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
      expect(res.body.code).toBe('not_a_pdf');
    });

    it('rejects an over-size file with file_too_large', async () => {
      const res = await requestUploadUrl({
        ...validUploadBody,
        fileSizeBytes: 50 * 1024 * 1024 + 1,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('file_too_large');
    });

    it('returns a 5-minute presigned PUT pinned to a books/{userId}/ key', async () => {
      const me = await request(server()).get('/api/v1/me').set(header());
      const res = await requestUploadUrl(validUploadBody);

      expect(res.status).toBe(201);
      expect(() => CreateUploadUrlResponse.parse(res.body)).not.toThrow();
      expect(res.body.expiresInSeconds).toBe(300);
      expect(res.body.s3Key).toMatch(
        new RegExp(`^books/${me.body.id}/[0-9a-f-]{36}\\.pdf$`),
      );
      expect(res.body.uploadUrl).toContain(res.body.s3Key);
    });
  });

  describe('POST /books', () => {
    async function landUpload(overrides: { size?: number } = {}) {
      const url: CreateUploadUrlResponse = (
        await requestUploadUrl(validUploadBody)
      ).body;
      storage.putObject(
        url.s3Key,
        overrides.size ?? validUploadBody.fileSizeBytes,
      );
      return url;
    }

    it('rejects an s3Key outside the caller prefix with s3_key_mismatch', async () => {
      await request(server()).get('/api/v1/me').set(header());
      const res = await request(server())
        .post('/api/v1/books')
        .set(header())
        .send({
          s3Key: 'books/someone-else/abc.pdf',
          originalFilename: 'x.pdf',
          fileSizeBytes: 100,
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('s3_key_mismatch');
    });

    it('rejects a missing upload with upload_not_found', async () => {
      const url: CreateUploadUrlResponse = (
        await requestUploadUrl(validUploadBody)
      ).body;
      const res = await request(server())
        .post('/api/v1/books')
        .set(header())
        .send({
          s3Key: url.s3Key,
          originalFilename: validUploadBody.filename,
          fileSizeBytes: validUploadBody.fileSizeBytes,
        });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('upload_not_found');
    });

    it('rejects a size mismatch with file_size_mismatch', async () => {
      const url = await landUpload({ size: 999 });
      const res = await request(server())
        .post('/api/v1/books')
        .set(header())
        .send({
          s3Key: url.s3Key,
          originalFilename: validUploadBody.filename,
          fileSizeBytes: validUploadBody.fileSizeBytes,
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('file_size_mismatch');
    });

    it('accepts a real PUT to the presigned URL and then registers the book', async () => {
      const bytes = Buffer.alloc(4096, 7);
      const { s3Key, uploadUrl } = (
        await requestUploadUrl({
          ...validUploadBody,
          fileSizeBytes: bytes.length,
        })
      ).body as CreateUploadUrlResponse;

      // The browser PUTs straight to the URL the API handed back.
      const target = new URL(uploadUrl);
      const put = await request(server())
        .put(target.pathname + target.search)
        .set('Content-Type', 'application/pdf')
        .send(bytes);
      expect(put.status).toBe(200);

      const created = await request(server())
        .post('/api/v1/books')
        .set(header())
        .send({
          s3Key,
          originalFilename: validUploadBody.filename,
          fileSizeBytes: bytes.length,
        });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('pending');
    });

    it('is idempotent when POST /books is replayed for the same s3Key', async () => {
      const url = await landUpload();
      const body = {
        s3Key: url.s3Key,
        originalFilename: validUploadBody.filename,
        fileSizeBytes: validUploadBody.fileSizeBytes,
      };
      const first = await request(server())
        .post('/api/v1/books')
        .set(header())
        .send(body);
      const second = await request(server())
        .post('/api/v1/books')
        .set(header())
        .send(body);

      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);

      const list = await request(server()).get('/api/v1/books').set(header());
      expect(list.body).toHaveLength(1);
      expect(queue.recorded).toHaveLength(1);
    });

    it('lands a pending book, enqueues one ingest job, and lists it', async () => {
      const url = await landUpload();
      const created = await request(server())
        .post('/api/v1/books')
        .set(header())
        .send({
          s3Key: url.s3Key,
          originalFilename: validUploadBody.filename,
          fileSizeBytes: validUploadBody.fileSizeBytes,
          title: 'The Pragmatic Programmer',
        });

      expect(created.status).toBe(201);
      expect(created.body.status).toBe('pending');
      expect(created.body.title).toBe('The Pragmatic Programmer');
      expect(created.body.originalFilename).toBe(validUploadBody.filename);

      // The ingest job id is the book id, carrying the request id through.
      expect(queue.recorded).toHaveLength(1);
      const [job] = queue.recorded;
      expect(job.name).toBe('ingest');
      expect(job.jobId).toBe(created.body.id);
      expect((job.data as { bookId: string }).bookId).toBe(created.body.id);

      const list = await request(server()).get('/api/v1/books').set(header());
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(() => BookListItemDto.array().parse(list.body)).not.toThrow();
      expect(list.body[0].id).toBe(created.body.id);
    });

    it('returns books newest-first, scoped to the caller', async () => {
      const first = await landUpload();
      await request(server()).post('/api/v1/books').set(header()).send({
        s3Key: first.s3Key,
        originalFilename: 'first.pdf',
        fileSizeBytes: validUploadBody.fileSizeBytes,
      });
      const second = await landUpload();
      const secondBook = await request(server())
        .post('/api/v1/books')
        .set(header())
        .send({
          s3Key: second.s3Key,
          originalFilename: 'second.pdf',
          fileSizeBytes: validUploadBody.fileSizeBytes,
        });

      const list = await request(server()).get('/api/v1/books').set(header());
      expect(list.body.map((b: { id: string }) => b.id)[0]).toBe(
        secondBook.body.id,
      );

      const bob = await request(server())
        .get('/api/v1/books')
        .set(
          auth.authHeaderFor({
            clerkUserId: 'user_bob',
            email: 'bob@example.com',
          }),
        );
      expect(bob.body).toEqual([]);
    });
  });
});
