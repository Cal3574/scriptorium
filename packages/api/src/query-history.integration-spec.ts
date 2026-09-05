import type { INestApplication } from '@nestjs/common';
import {
  parseQueryEventFrame,
  QueryDetailDto,
  QueryListItemDto,
  type QueryEvent,
} from '@scriptorium/contracts';
import { FakeEmbeddingClient } from '@scriptorium/providers';
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

// Seam 1: `GET /api/v1/queries` and `GET /api/v1/queries/:id` against the real
// Nest app + real Postgres. Asserts the list shape, the detail shape, a
// null-answer row surfaced as failed, and that a query's citations still
// render after the book they cite is deleted.
describe('query history (Seam 1)', () => {
  let db: TestDatabase;
  let auth: TestAuthority;
  let app: INestApplication;

  const alice = () =>
    auth.authHeaderFor({
      clerkUserId: 'user_alice',
      email: 'alice@example.com',
    });
  const bob = () =>
    auth.authHeaderFor({ clerkUserId: 'user_bob', email: 'bob@example.com' });
  const server = () => app.getHttpServer();

  const QUESTION = 'What do these authors say about acting under uncertainty?';
  let matchVectorLiteral: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    auth = createTestAuthority();
    app = await createTestApp({ jwtKey: auth.jwtKey, databaseUrl: db.url });
    const [vector] = await new FakeEmbeddingClient().embed([QUESTION]);
    matchVectorLiteral = `[${vector.join(',')}]`;
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
  });

  // Plant a user, a book, a chapter and `count` embedded chunks whose vector
  // matches the question, and return both the user id and the book id.
  async function plantLibrary(
    header: { Authorization: string },
    count = 3,
  ): Promise<{ userId: string; bookId: string }> {
    const me = await request(server())
      .get('/api/v1/me')
      .set(header)
      .expect(200);
    const userId = me.body.id as string;

    const book = await db.pool.query(
      `INSERT INTO books (user_id, title, original_filename, s3_key, status)
       VALUES ($1, 'On Uncertainty', 'uncertainty.pdf', $2, 'ready')
       RETURNING id`,
      [userId, `books/${userId}/uncertainty.pdf`],
    );
    const bookId = book.rows[0].id as string;
    const chapter = await db.pool.query(
      `INSERT INTO chapters (book_id, chapter_index, title)
       VALUES ($1, 0, 'Chapter 1') RETURNING id`,
      [bookId],
    );
    const chapterId = chapter.rows[0].id as string;

    for (let i = 0; i < count; i++) {
      await db.pool.query(
        `INSERT INTO chunks
           (chapter_id, book_id, user_id, chunk_index, chunk_text,
            book_title, chapter_title, embedding)
         VALUES ($1, $2, $3, $4, $5, 'On Uncertainty', 'Chapter 1', $6::vector)`,
        [
          chapterId,
          bookId,
          userId,
          i,
          `Passage ${i}: on acting well without complete information.`,
          matchVectorLiteral,
        ],
      );
    }
    return { userId, bookId };
  }

  function parseSse(raw: string): QueryEvent[] {
    const events: QueryEvent[] = [];
    for (const block of raw.split('\n\n')) {
      const event = parseQueryEventFrame(block);
      if (event) events.push(event);
    }
    return events;
  }

  // Runs a real query through `POST /queries` and returns its id.
  async function ask(
    header: { Authorization: string },
    body: Record<string, unknown> = { question: QUESTION },
  ): Promise<string> {
    const res = await request(server())
      .post('/api/v1/queries')
      .set(header)
      .set('Accept', 'text/event-stream')
      .buffer(true)
      .parse((response, cb) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (data += chunk));
        response.on('end', () => cb(null, data));
      })
      .send(body);
    const text =
      typeof res.body === 'string' && res.body ? res.body : res.text || '';
    const events = parseSse(text);
    const started = events.find(
      (e): e is Extract<QueryEvent, { type: 'query_started' }> =>
        e.type === 'query_started',
    );
    if (!started) throw new Error('query never started');
    return started.id;
  }

  describe('GET /queries', () => {
    it('returns the flat, newest-first list shape with no answer body', async () => {
      const { bookId } = await plantLibrary(alice());
      const first = await ask(alice());
      const second = await ask(alice(), { question: QUESTION, bookId });

      const res = await request(server()).get('/api/v1/queries').set(alice());

      expect(res.status).toBe(200);
      for (const item of res.body) {
        expect(() => QueryListItemDto.parse(item)).not.toThrow();
      }
      expect(res.body.map((item: { id: string }) => item.id)).toEqual([
        second,
        first,
      ]);
      expect(res.body[0].bookId).toBe(bookId);
      expect(res.body[1].bookId).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('"answer"');
    });

    it("scopes the list to the caller - Bob never sees Alice's history", async () => {
      await plantLibrary(alice());
      await plantLibrary(bob());
      await ask(alice());

      const res = await request(server()).get('/api/v1/queries').set(bob());
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('surfaces a null-answer row as failed', async () => {
      const { userId } = await plantLibrary(alice());
      await db.pool.query(
        `INSERT INTO queries (user_id, question, answer) VALUES ($1, $2, NULL)`,
        [userId, QUESTION],
      );

      const res = await request(server()).get('/api/v1/queries').set(alice());
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].failed).toBe(true);
    });

    it('does not mark a completed query as failed', async () => {
      await plantLibrary(alice());
      await ask(alice());

      const res = await request(server()).get('/api/v1/queries').set(alice());
      expect(res.body).toHaveLength(1);
      expect(res.body[0].failed).toBe(false);
    });
  });

  describe('GET /queries/:id', () => {
    it('returns the detail shape with the answer and citations snapshot', async () => {
      await plantLibrary(alice());
      const id = await ask(alice());

      const res = await request(server())
        .get(`/api/v1/queries/${id}`)
        .set(alice());

      expect(res.status).toBe(200);
      expect(() => QueryDetailDto.parse(res.body)).not.toThrow();
      expect(res.body.question).toBe(QUESTION);
      expect(res.body.answer).not.toBeNull();
      expect(res.body.citations.length).toBeGreaterThan(0);
      expect(res.body.citations[0]).toEqual(
        expect.objectContaining({
          chunkId: expect.any(String),
          bookTitle: 'On Uncertainty',
          chapterTitle: 'Chapter 1',
          chunkText: expect.any(String),
        }),
      );
      // The frozen snapshot drops `bookId` and `marker` - `Citation` minus
      // those two fields.
      expect(res.body.citations[0]).not.toHaveProperty('bookId');
      expect(res.body.citations[0]).not.toHaveProperty('marker');
    });

    it('returns a null answer and empty citations for a failed query', async () => {
      const { userId } = await plantLibrary(alice());
      const row = await db.pool.query(
        `INSERT INTO queries (user_id, question, answer) VALUES ($1, $2, NULL) RETURNING id`,
        [userId, QUESTION],
      );
      const id = row.rows[0].id as string;

      const res = await request(server())
        .get(`/api/v1/queries/${id}`)
        .set(alice());
      expect(res.status).toBe(200);
      expect(res.body.answer).toBeNull();
      expect(res.body.citations).toEqual([]);
    });

    it('still renders the citations snapshot after the cited book is deleted', async () => {
      await plantLibrary(alice());
      const id = await ask(alice());

      const before = await request(server())
        .get(`/api/v1/queries/${id}`)
        .set(alice());
      const citedBookTitle = before.body.citations[0].bookTitle;

      // Hard delete the book directly - `queries.book_id` is `ON DELETE SET
      // NULL`, and `citations` is a frozen jsonb snapshot with no FK at all.
      await db.pool.query(`DELETE FROM books`);

      const after = await request(server())
        .get(`/api/v1/queries/${id}`)
        .set(alice());
      expect(after.status).toBe(200);
      expect(after.body.bookId).toBeNull();
      expect(after.body.citations).toHaveLength(before.body.citations.length);
      expect(after.body.citations[0].bookTitle).toBe(citedBookTitle);
    });

    it("is an identical 404 for an unknown id and for another user's query", async () => {
      await plantLibrary(alice());
      const id = await ask(alice());

      const unknown = await request(server())
        .get('/api/v1/queries/11111111-1111-4111-8111-111111111111')
        .set(alice());
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('query_not_found');

      await plantLibrary(bob());
      const notYours = await request(server())
        .get(`/api/v1/queries/${id}`)
        .set(bob());
      expect(notYours.status).toBe(404);
      expect(notYours.body.code).toBe('query_not_found');
    });
  });
});
