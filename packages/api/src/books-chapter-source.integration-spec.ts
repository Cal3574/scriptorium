import type { INestApplication } from '@nestjs/common';
import {
  ChapterSourceDto,
  type CreateUploadUrlResponse,
} from '@scriptorium/contracts';
import {
  FakeObjectStorage,
  FakeQueue,
  OBJECT_STORAGE,
  QUEUE,
} from '@scriptorium/providers';
import {
  extractionArtifactKey,
  saveExtractionArtifact,
  type BookRow,
  type ExtractionArtifact,
} from '@scriptorium/server-core';
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

// Seam 1: the real Nest app + real Postgres + a fake object storage seeded with
// a known extraction sidecar. Exercises
// `GET /books/:id/chapters/:chapterId/source` end to end.
describe("read a chapter's reconstructed source (Seam 1)", () => {
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

  // Land a `pending` book through the real upload handoff, then flip it to the
  // status the reader requires. Returns the book id and its storage key.
  async function createBook(
    status: 'ready' | 'summarizing' = 'ready',
  ): Promise<{ id: string; s3Key: string }> {
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
        originalFilename: validUploadBody.filename,
        fileSizeBytes: validUploadBody.fileSizeBytes,
      });
    expect(created.status).toBe(201);
    await db.pool.query('UPDATE books SET status = $1 WHERE id = $2', [
      status,
      created.body.id,
    ]);
    return { id: created.body.id as string, s3Key: url.s3Key };
  }

  async function addChapter(
    bookId: string,
    overrides: {
      chapterIndex?: number;
      title?: string;
      pageStart?: number | null;
      pageEnd?: number | null;
    } = {},
  ): Promise<string> {
    const res = await db.pool.query(
      `INSERT INTO chapters (book_id, chapter_index, title, page_start, page_end)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        bookId,
        overrides.chapterIndex ?? 0,
        overrides.title ?? 'Chapter 1',
        overrides.pageStart === undefined ? 2 : overrides.pageStart,
        overrides.pageEnd === undefined ? 3 : overrides.pageEnd,
      ],
    );
    return res.rows[0].id as string;
  }

  async function seedArtifact(
    s3Key: string,
    pages: ExtractionArtifact['pages'],
  ): Promise<void> {
    const artifact: ExtractionArtifact = {
      pages,
      items: [],
      outline: [],
      metadata: { title: 'Atomic Habits', author: null },
      pageCount: pages.length,
    };
    await saveExtractionArtifact(
      storage,
      extractionArtifactKey({ s3Key } as BookRow),
      artifact,
    );
  }

  const path = (bookId: string, chapterId: string) =>
    `/api/v1/books/${bookId}/chapters/${chapterId}/source`;

  it('stitches the chapter page range into markdown with an immutable cache header', async () => {
    const { id, s3Key } = await createBook();
    const chapterId = await addChapter(id, { pageStart: 2, pageEnd: 3 });
    await seedArtifact(s3Key, [
      { page: 1, markdown: '# Front matter' },
      { page: 2, markdown: '## Chapter 1\n\nThe habit loop.' },
      { page: 3, markdown: 'Cue, craving, response, reward.' },
      { page: 4, markdown: 'Chapter 2 begins.' },
    ]);

    const res = await request(server()).get(path(id, chapterId)).set(header());

    expect(res.status).toBe(200);
    expect(() => ChapterSourceDto.parse(res.body)).not.toThrow();
    expect(res.body).toMatchObject({
      chapterId,
      chapterIndex: 0,
      title: 'Chapter 1',
      pageStart: 2,
      pageEnd: 3,
      available: true,
      truncated: false,
    });
    expect(res.body.text).toBe(
      '## Chapter 1\n\nThe habit loop.\n\nCue, craving, response, reward.',
    );
    expect(res.headers['cache-control']).toBe(
      'private, max-age=86400, immutable',
    );
    expect(JSON.stringify(res.body)).not.toContain('chunk');
  });

  it('returns available:false with a 200 when the page range holds no text', async () => {
    const { id, s3Key } = await createBook();
    const chapterId = await addChapter(id, { pageStart: 2, pageEnd: 2 });
    await seedArtifact(s3Key, [
      { page: 1, markdown: 'real prose' },
      { page: 2, markdown: '   \n\n ' },
    ]);

    const res = await request(server()).get(path(id, chapterId)).set(header());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      available: false,
      text: null,
      truncated: false,
    });
  });

  it('returns available:false with a 200 when the extraction artifact is missing', async () => {
    const { id } = await createBook();
    const chapterId = await addChapter(id);

    const res = await request(server()).get(path(id, chapterId)).set(header());

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.text).toBeNull();
  });

  it("is an identical 404 for an unknown book and another user's book", async () => {
    const { id, s3Key } = await createBook();
    const chapterId = await addChapter(id);
    await seedArtifact(s3Key, [{ page: 2, markdown: 'text' }]);

    const unknown = await request(server())
      .get(path('11111111-1111-4111-8111-111111111111', chapterId))
      .set(header());
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('book_not_found');

    const notYours = await request(server())
      .get(path(id, chapterId))
      .set(bobHeader());
    expect(notYours.status).toBe(404);
    expect(notYours.body.code).toBe('book_not_found');
  });

  it('is a 404 book_not_found (not 409) for a book that is not ready', async () => {
    const { id, s3Key } = await createBook('summarizing');
    const chapterId = await addChapter(id);
    await seedArtifact(s3Key, [{ page: 2, markdown: 'text' }]);

    const res = await request(server()).get(path(id, chapterId)).set(header());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('book_not_found');
    // The immutable cache header must never ride on an error response.
    expect(res.headers['cache-control'] ?? '').not.toContain('immutable');
  });

  it('rejects a non-uuid chapterId with a 400', async () => {
    const { id } = await createBook();

    const res = await request(server())
      .get(path(id, 'not-a-uuid'))
      .set(header());

    expect(res.status).toBe(400);
  });

  it("is a 404 chapter_not_found for a valid uuid that is not this book's chapter", async () => {
    const { id } = await createBook();
    await addChapter(id);
    const otherBook = await createBook();
    const foreignChapter = await addChapter(otherBook.id, {
      title: 'Elsewhere',
    });

    const res = await request(server())
      .get(path(id, foreignChapter))
      .set(header());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('chapter_not_found');
  });
});
