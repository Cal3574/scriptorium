import type { INestApplication } from '@nestjs/common';
import { UsageDto } from '@scriptorium/contracts';
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

// Seam 1: `GET /api/v1/me/usage` over the real Nest app + Postgres, booted
// with the shipped DEFAULT_PLAN_LIMITS (free 2/20, pro 50/1000) so the wire
// numbers are the real ceilings. Counts derive from seeded rows.
describe('usage endpoint (Seam 1)', () => {
  let db: TestDatabase;
  let auth: TestAuthority;
  let app: INestApplication;

  beforeAll(async () => {
    db = await setupTestDatabase();
    auth = createTestAuthority();
    app = await createTestApp({ jwtKey: auth.jwtKey, databaseUrl: db.url });
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
  });

  const server = () => app.getHttpServer();

  const headerFor = (id: string, plan?: 'free' | 'pro') =>
    auth.authHeaderFor(
      { clerkUserId: id, email: `${id}@example.com` },
      plan ? { plan } : {},
    );

  async function userId(header: { Authorization: string }): Promise<string> {
    const me = await request(server())
      .get('/api/v1/me')
      .set(header)
      .expect(200);
    return me.body.id as string;
  }

  async function seedBooks(uid: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await db.pool.query(
        `INSERT INTO books (user_id, original_filename, s3_key, status)
         VALUES ($1, $2, $3, 'ready')`,
        [uid, `seed-${i}.pdf`, `books/${uid}/seed-${i}.pdf`],
      );
    }
  }

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
          `q ${i}`,
          opts.withAnswer ? `a ${i}` : null,
          opts.createdAt ?? null,
        ],
      );
    }
  }

  async function getUsage(header: {
    Authorization: string;
  }): Promise<request.Response> {
    return request(server()).get('/api/v1/me/usage').set(header);
  }

  it('returns the UsageDto shape with Free limits and counts matching the rows', async () => {
    const header = headerFor('user_free', 'free');
    const uid = await userId(header);
    await seedBooks(uid, 1);
    await seedQueries(uid, 3, { withAnswer: false });
    await seedQueries(uid, 2, { withAnswer: true });

    const res = await getUsage(header);
    expect(res.status).toBe(200);
    // Parses against the real contract - fails loudly on any shape drift.
    const usage = UsageDto.parse(res.body);
    expect(usage).toMatchObject({
      plan: 'free',
      books: { used: 1, limit: 2 },
      queries: { used: 5, limit: 20 },
    });
  });

  it('applies the Pro ceilings', async () => {
    const header = headerFor('user_pro', 'pro');
    await userId(header);

    const res = await getUsage(header);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      plan: 'pro',
      books: { used: 0, limit: 50 },
      queries: { used: 0, limit: 1000 },
    });
  });

  it('treats a token with no plan claim as Free', async () => {
    const header = headerFor('user_noplan');
    await userId(header);

    const res = await getUsage(header);
    expect(res.body.plan).toBe('free');
    expect(res.body.books.limit).toBe(2);
    expect(res.body.queries.limit).toBe(20);
  });

  it('resetsAt is the next UTC month boundary', async () => {
    const header = headerFor('user_reset', 'free');
    await userId(header);

    const { resetsAt } = (await getUsage(header)).body.queries as {
      resetsAt: string;
    };
    const at = new Date(resetsAt);
    expect(at.getUTCDate()).toBe(1);
    expect(at.getUTCHours()).toBe(0);
    expect(at.getUTCMinutes()).toBe(0);
    expect(at.getUTCSeconds()).toBe(0);
    expect(at.getUTCMilliseconds()).toBe(0);

    const now = new Date();
    const expectedMonth = (now.getUTCMonth() + 1) % 12;
    expect(at.getUTCMonth()).toBe(expectedMonth);
    expect(at.getTime()).toBeGreaterThan(now.getTime());
  });

  it('excludes query rows created before the current UTC month', async () => {
    const header = headerFor('user_lastmonth', 'free');
    const uid = await userId(header);

    const now = new Date();
    const lastMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1000,
    );
    await seedQueries(uid, 4, { createdAt: lastMonth });
    await seedQueries(uid, 2);

    const res = await getUsage(header);
    expect(res.body.queries.used).toBe(2);
  });

  it('is not quota-guarded: a reader over their query ceiling still gets 200', async () => {
    const header = headerFor('user_over', 'free');
    const uid = await userId(header);
    await seedQueries(uid, 25);

    const res = await getUsage(header);
    expect(res.status).toBe(200);
    expect(res.body.queries).toMatchObject({ used: 25, limit: 20 });
  });

  it('rejects a no-token request with 401', async () => {
    const res = await request(server()).get('/api/v1/me/usage');
    expect(res.status).toBe(401);
  });
});
