import type { INestApplication } from '@nestjs/common';
import { parseQueryEventFrame, type QueryEvent } from '@scriptorium/contracts';
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

// Seam 1: `POST /api/v1/queries` against the real Nest app + real Postgres +
// pgvector, with the fake embedding / LLM clients. Asserts the SSE event
// order, that the concatenated `text_delta`s equal `done.answer`, and that
// exactly one row is written (inserted null, updated once at `done`).
describe('cross-book RAG query (Seam 1)', () => {
  let db: TestDatabase;
  let auth: TestAuthority;
  let app: INestApplication;

  const alice = () =>
    auth.authHeaderFor({ clerkUserId: 'user_alice', email: 'alice@example.com' });
  const bob = () =>
    auth.authHeaderFor({ clerkUserId: 'user_bob', email: 'bob@example.com' });
  const server = () => app.getHttpServer();

  const QUESTION = 'What do these authors say about acting under uncertainty?';
  // The fake embedding client is deterministic per string, so we can plant
  // chunks whose stored vector is exactly the question's - similarity 1.0,
  // comfortably above the 0.25 floor.
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
  // matches the question. Returns the book id.
  async function plantLibrary(
    header: { Authorization: string },
    count = 3,
  ): Promise<string> {
    // The auth guard provisions the user row on the first authenticated call.
    const me = await request(server()).get('/api/v1/me').set(header).expect(200);
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
    return bookId;
  }

  function parseSse(raw: string): QueryEvent[] {
    const events: QueryEvent[] = [];
    for (const block of raw.split('\n\n')) {
      const event = parseQueryEventFrame(block);
      if (event) events.push(event);
    }
    return events;
  }

  async function ask(
    header: { Authorization: string },
    body: Record<string, unknown>,
  ): Promise<{ status: number; events: QueryEvent[]; text: string }> {
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
    const events = res.status === 200 && text ? parseSse(text) : [];
    return { status: res.status, events, text };
  }

  it('streams query_started, citations, text_delta+, done in order', async () => {
    await plantLibrary(alice());
    const { status, events } = await ask(alice(), { question: QUESTION });

    expect(status).toBe(200);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('query_started');
    expect(types[1]).toBe('citations');
    expect(types[types.length - 1]).toBe('done');
    expect(types.slice(2, -1).every((t) => t === 'text_delta')).toBe(true);
    expect(types).toContain('text_delta');
  });

  it('concatenated text_delta payloads equal done.answer', async () => {
    await plantLibrary(alice());
    const { events } = await ask(alice(), { question: QUESTION });

    const streamed = events
      .filter((e): e is Extract<QueryEvent, { type: 'text_delta' }> => e.type === 'text_delta')
      .map((e) => e.text)
      .join('');
    const done = events.find(
      (e): e is Extract<QueryEvent, { type: 'done' }> => e.type === 'done',
    );
    expect(done).toBeDefined();
    expect(streamed).toBe(done?.answer);
  });

  it('writes exactly one row: inserted null, updated once at done', async () => {
    await plantLibrary(alice());
    const { events } = await ask(alice(), { question: QUESTION });

    const started = events.find(
      (e): e is Extract<QueryEvent, { type: 'query_started' }> =>
        e.type === 'query_started',
    );
    const citations = events.find(
      (e): e is Extract<QueryEvent, { type: 'citations' }> => e.type === 'citations',
    );

    const { rows } = await db.pool.query(
      `SELECT id, question, answer, citations, book_id FROM queries`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(started?.id);
    expect(rows[0].question).toBe(QUESTION);
    expect(rows[0].answer).not.toBeNull();
    expect(rows[0].book_id).toBeNull();

    // Persisted citations are the selected set minus `bookId` and `marker`.
    expect(rows[0].citations).toHaveLength(citations?.citations.length ?? 0);
    for (const persisted of rows[0].citations) {
      expect(persisted).toEqual(
        expect.objectContaining({
          chunkId: expect.any(String),
          bookTitle: 'On Uncertainty',
          chapterTitle: 'Chapter 1',
          chunkText: expect.any(String),
        }),
      );
      expect(persisted).not.toHaveProperty('bookId');
      expect(persisted).not.toHaveProperty('marker');
    }
    // The `citations` event keeps the full shape, in `[n]` order.
    expect(citations?.citations[0]).toEqual(
      expect.objectContaining({ marker: 1, bookId: expect.any(String) }),
    );
  });

  it('restricts retrieval to an owned bookId and 404s a foreign one', async () => {
    const aliceBook = await plantLibrary(alice(), 3);
    await plantLibrary(bob(), 3);

    const ok = await ask(alice(), { question: QUESTION, bookId: aliceBook });
    expect(ok.status).toBe(200);

    const foreign = await ask(alice(), {
      question: QUESTION,
      bookId: '11111111-1111-4111-8111-111111111111',
    });
    expect(foreign.status).toBe(404);
    expect(JSON.parse(foreign.text).code).toBe('book_not_found');
  });

  it('answers "not enough context" without a synthesis call when nothing is retrieved', async () => {
    // A user with a book but no embedded chunks: the candidate pool is empty.
    await request(server()).get('/api/v1/me').set(alice()).expect(200);
    const { events } = await ask(alice(), { question: QUESTION });

    const citations = events.find((e) => e.type === 'citations');
    const done = events.find(
      (e): e is Extract<QueryEvent, { type: 'done' }> => e.type === 'done',
    );
    expect(citations).toMatchObject({ type: 'citations', citations: [] });
    expect(done?.answer).toBe('The library does not seem to cover this.');
    expect(events.some((e) => e.type === 'text_delta')).toBe(false);

    const { rows } = await db.pool.query(`SELECT answer, citations FROM queries`);
    expect(rows).toHaveLength(1);
    expect(rows[0].answer).toBe('The library does not seem to cover this.');
    expect(rows[0].citations).toEqual([]);
  });

  it('rejects an over-length question with 422 question_too_long', async () => {
    await plantLibrary(alice());
    const res = await ask(alice(), { question: 'x'.repeat(2001) });
    expect(res.status).toBe(422);
    expect(JSON.parse(res.text).code).toBe('question_too_long');
  });
});
