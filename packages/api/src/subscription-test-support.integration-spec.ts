import { DEFAULT_PLAN_LIMITS } from '@scriptorium/server-core';
import request from 'supertest';
import { createTestApp } from './test-support/create-test-app';
import { createTestAuthority, type TestAuthority } from './test-support/rsa-jwt';
import {
  setupTestDatabase,
  type TestDatabase,
} from './test-support/test-database';

// Seam 1: proves the subscription test infrastructure (plan-claim JWTs, the
// `planLimits` test-app option) works end to end against the real app, so the
// entitlement tickets that build on it can trust it.
describe('subscription test support (Seam 1)', () => {
  let db: TestDatabase;
  let auth: TestAuthority;

  beforeAll(async () => {
    db = await setupTestDatabase();
    auth = createTestAuthority();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(() => db.truncateAll());

  const tinyLimits = {
    free: { books: 1, queries: 1 },
    pro: { books: 3, queries: 3 },
  };

  it('still authenticates a plan-carrying token with no network call', async () => {
    const app = await createTestApp({ jwtKey: auth.jwtKey, databaseUrl: db.url });
    try {
      const res = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set(
          auth.authHeaderFor(
            { clerkUserId: 'user_pro', email: 'pro@example.com' },
            { plan: 'pro', features: ['export'] },
          ),
        );
      expect(res.status).toBe(200);
      expect(res.body.email).toBe('pro@example.com');
    } finally {
      await app.close();
    }
  });

  it('resolves the injected planLimits from the PLAN_LIMITS token', async () => {
    const app = await createTestApp({
      jwtKey: auth.jwtKey,
      databaseUrl: db.url,
      planLimits: tinyLimits,
    });
    try {
      const res = await request(app.getHttpServer())
        .get('/api/v1/_probe/plan-limits')
        .set(
          auth.authHeaderFor({
            clerkUserId: 'user_a',
            email: 'a@example.com',
          }),
        );
      expect(res.status).toBe(200);
      expect(res.body).toEqual(tinyLimits);
    } finally {
      await app.close();
    }
  });

  it('falls back to the shipped limits when the option is omitted', async () => {
    const app = await createTestApp({ jwtKey: auth.jwtKey, databaseUrl: db.url });
    try {
      const res = await request(app.getHttpServer())
        .get('/api/v1/_probe/plan-limits')
        .set(
          auth.authHeaderFor({
            clerkUserId: 'user_b',
            email: 'b@example.com',
          }),
        );
      expect(res.body).toEqual(DEFAULT_PLAN_LIMITS);
    } finally {
      await app.close();
    }
  });
});
