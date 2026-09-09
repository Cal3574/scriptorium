import type { INestApplication } from '@nestjs/common';
import type { QueryEvent } from '@scriptorium/contracts';
import request from 'supertest';
import { createTestApp } from './test-support/create-test-app';
import {
  askQuery,
  plantRagLibrary,
  RAG_QUESTION,
  ragMatchVectorLiteral,
} from './test-support/rag-query';
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
    auth.authHeaderFor({
      clerkUserId: 'user_alice',
      email: 'alice@example.com',
    });
  const bob = () =>
    auth.authHeaderFor({ clerkUserId: 'user_bob', email: 'bob@example.com' });
  const server = () => app.getHttpServer();

  const QUESTION = RAG_QUESTION;
  let matchVectorLiteral: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    auth = createTestAuthority();
    app = await createTestApp({ jwtKey: auth.jwtKey, databaseUrl: db.url });
    matchVectorLiteral = await ragMatchVectorLiteral();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
  });

  // Resolve the caller's user id (the auth guard provisions the row on the
  // first authenticated call), then plant a matching library under it.
  async function plantLibrary(
    header: { Authorization: string },
    count = 3,
  ): Promise<string> {
    const me = await request(server())
      .get('/api/v1/me')
      .set(header)
      .expect(200);
    return plantRagLibrary(db, me.body.id as string, matchVectorLiteral, count);
  }

  const ask = (
    header: { Authorization: string },
    body: Record<string, unknown>,
  ) => askQuery(server, header, body);

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
      .filter(
        (e): e is Extract<QueryEvent, { type: 'text_delta' }> =>
          e.type === 'text_delta',
      )
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
      (e): e is Extract<QueryEvent, { type: 'citations' }> =>
        e.type === 'citations',
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

    const { rows } = await db.pool.query(
      `SELECT answer, citations FROM queries`,
    );
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
