import type { INestApplication } from '@nestjs/common';
import { PROBLEM_CONTENT_TYPE } from '@scriptorium/contracts';
import type { PlanLimits } from '@scriptorium/server-core';
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

// Seam 1: the `@Quota('queries')` guard over the real Nest app + Postgres,
// booted with tiny monthly limits so the ceiling is reached in a couple of
// rows, not twenty. The guard runs before the SSE stream opens, so an
// over-quota reader gets `402 query_limit_reached` as problem+json and no
// `queries` row is written.
describe('query quota enforcement (Seam 1)', () => {
  let db: TestDatabase;
  let auth: TestAuthority;
  let app: INestApplication;
  let matchVector: string;

  // free queries = 2, pro queries = 3 (tiny stand-ins for 20 / 1000, enough to
  // prove the higher ceiling applies).
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
    matchVector = await ragMatchVectorLiteral();
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
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

  async function userId(header: { Authorization: string }): Promise<string> {
    const me = await request(server())
      .get('/api/v1/me')
      .set(header)
      .expect(200);
    return me.body.id as string;
  }

  // Insert `n` `queries` rows straight into the table, bypassing the guard.
  // `answer` stays null unless `withAnswer` - a failed synthesis still spent
  // the embedding + retrieval, so it counts.
  async function seedQueries(
    uid: string,
    n: number,
    opts: { createdAt?: Date; withAnswer?: boolean } = {},
  ): Promise<void> {
    for (let i = 0; i < n; i++) {
      await db.pool.query(
        `INSERT INTO queries (user_id, question, answer, created_at)
         VALUES ($1, $2, $3, COALESCE($4, now()))`,
        [
          uid,
          `seeded question ${i}`,
          opts.withAnswer ? `seeded answer ${i}` : null,
          opts.createdAt ?? null,
        ],
      );
    }
  }

  async function queryCount(uid: string): Promise<number> {
    const { rows } = await db.pool.query(
      'SELECT count(*)::int AS n FROM queries WHERE user_id = $1',
      [uid],
    );
    return rows[0].n;
  }

  const codeOf = (text: string): string | undefined => {
    try {
      return JSON.parse(text).code;
    } catch {
      return undefined;
    }
  };

  it('lets a Free reader ask up to the limit, then returns 402 with no row written', async () => {
    const header = freeHeader();
    const uid = await userId(header);
    await plantRagLibrary(db, uid, matchVector);
    await seedQueries(uid, 2);

    const blocked = await askQuery(server, header, { question: RAG_QUESTION });
    expect(blocked.status).toBe(402);
    expect(blocked.contentType).toContain(PROBLEM_CONTENT_TYPE);
    expect(codeOf(blocked.text)).toBe('query_limit_reached');
    expect(blocked.events).toHaveLength(0);
    expect(await queryCount(uid)).toBe(2);
  });

  it('applies the higher Pro ceiling', async () => {
    const header = proHeader();
    const uid = await userId(header);
    await plantRagLibrary(db, uid, matchVector);

    // At 2 of 3 the query still runs and writes the 3rd row.
    await seedQueries(uid, 2);
    const ok = await askQuery(server, header, { question: RAG_QUESTION });
    expect(ok.status).toBe(200);
    expect(ok.events.map((e) => e.type)).toContain('done');
    expect(await queryCount(uid)).toBe(3);

    const blocked = await askQuery(server, header, { question: RAG_QUESTION });
    expect(blocked.status).toBe(402);
    expect(codeOf(blocked.text)).toBe('query_limit_reached');
  });

  it('counts rows whose answer is null toward the total', async () => {
    const header = freeHeader('user_nulls');
    const uid = await userId(header);
    await plantRagLibrary(db, uid, matchVector);
    await seedQueries(uid, 2, { withAnswer: false });

    const blocked = await askQuery(server, header, { question: RAG_QUESTION });
    expect(blocked.status).toBe(402);
    expect(codeOf(blocked.text)).toBe('query_limit_reached');
  });

  it('does not count rows created before the UTC month boundary', async () => {
    const header = freeHeader('user_boundary');
    const uid = await userId(header);
    await plantRagLibrary(db, uid, matchVector);

    const now = new Date();
    const lastMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1000,
    );
    // Two rows just before this UTC month (must not count) + one this month.
    await seedQueries(uid, 2, { createdAt: lastMonth });
    await seedQueries(uid, 1);

    const ok = await askQuery(server, header, { question: RAG_QUESTION });
    expect(ok.status).toBe(200);
    expect(ok.events.map((e) => e.type)).toContain('done');
  });

  it('treats a token with no plan claim as Free', async () => {
    const header = auth.authHeaderFor({
      clerkUserId: 'user_noplan',
      email: 'noplan@example.com',
    });
    const uid = await userId(header);
    await plantRagLibrary(db, uid, matchVector);
    await seedQueries(uid, 2);

    const blocked = await askQuery(server, header, { question: RAG_QUESTION });
    expect(blocked.status).toBe(402);
    expect(codeOf(blocked.text)).toBe('query_limit_reached');
  });

  it('still lets an over-quota reader read their query history', async () => {
    const header = freeHeader('user_reads');
    const uid = await userId(header);
    await seedQueries(uid, 5);

    const res = await request(server()).get('/api/v1/queries').set(header);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
  });
});
