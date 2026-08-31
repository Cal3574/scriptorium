import type { INestApplication } from '@nestjs/common';
import { PROBLEM_CONTENT_TYPE, UserDto } from '@scriptorium/contracts';
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

// Seam 1: the real Nest app, a real Postgres, and locally-minted RSA JWTs.
describe('auth and account identity (Seam 1)', () => {
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

  beforeEach(() => db.truncateAll());

  const server = () => app.getHttpServer();

  it('serves GET /health without a token, outside the version prefix', async () => {
    const res = await request(server()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('identifies the signed-in user and JIT-provisions one local row', async () => {
    const header = auth.authHeaderFor({
      clerkUserId: 'user_alice',
      email: 'alice@example.com',
    });

    const first = await request(server()).get('/api/v1/me').set(header);
    expect(first.status).toBe(200);
    expect(() => UserDto.parse(first.body)).not.toThrow();
    expect(first.body.email).toBe('alice@example.com');

    const second = await request(server()).get('/api/v1/me').set(header);
    expect(second.body.id).toBe(first.body.id);

    const rows = await db.pool.query(
      'SELECT id, email FROM users WHERE clerk_user_id = $1',
      ['user_alice'],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].email).toBe('alice@example.com');
  });

  it('refreshes the local email from the latest token', async () => {
    await request(server())
      .get('/api/v1/me')
      .set(
        auth.authHeaderFor({ clerkUserId: 'user_bob', email: 'bob@old.com' }),
      );
    const res = await request(server())
      .get('/api/v1/me')
      .set(
        auth.authHeaderFor({ clerkUserId: 'user_bob', email: 'bob@new.com' }),
      );
    expect(res.body.email).toBe('bob@new.com');
  });

  it('rejects a missing token with a 401 problem+json body', async () => {
    const res = await request(server()).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(res.body.code).toBe('unauthorized');
    expect(res.body.status).toBe(401);
    expect(res.body.instance).toBe(res.headers['x-request-id']);
  });

  it('rejects a forged token with a 401', async () => {
    const res = await request(server())
      .get('/api/v1/me')
      .set(auth.forgedHeader());
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it('echoes a caller-supplied X-Request-Id', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const res = await request(server())
      .get('/api/v1/me')
      .set('X-Request-Id', id);
    expect(res.headers['x-request-id']).toBe(id);
    expect(res.body.instance).toBe(id);
  });

  it('returns an identical 404 for a missing resource and one owned by another user', async () => {
    const aliceHeader = auth.authHeaderFor({
      clerkUserId: 'user_alice',
      email: 'alice@example.com',
    });
    const bobHeader = auth.authHeaderFor({
      clerkUserId: 'user_bob',
      email: 'bob@example.com',
    });
    // Provision both, then insert a book owned by Bob.
    await request(server()).get('/api/v1/me').set(aliceHeader);
    const bobMe = await request(server()).get('/api/v1/me').set(bobHeader);

    const {
      rows: [bobBook],
    } = await db.pool.query(
      `INSERT INTO books (user_id, original_filename, s3_key)
       VALUES ($1, $2, $3) RETURNING id`,
      [bobMe.body.id, 'x.pdf', `books/${bobMe.body.id}/x.pdf`],
    );

    const missing = await request(server())
      .get('/api/v1/_probe/books/99999999-9999-4999-8999-999999999999')
      .set(aliceHeader);
    const othersBook = await request(server())
      .get(`/api/v1/_probe/books/${bobBook.id}`)
      .set(aliceHeader);

    expect(missing.status).toBe(404);
    expect(othersBook.status).toBe(404);
    expect(othersBook.body.code).toBe('book_not_found');
    expect(othersBook.body).toEqual({
      ...missing.body,
      instance: othersBook.body.instance,
    });
  });

  it('separates malformed JSON (400) from a schema failure (422)', async () => {
    const header = auth.authHeaderFor({
      clerkUserId: 'user_alice',
      email: 'alice@example.com',
    });

    const badJson = await request(server())
      .post('/api/v1/_probe/echo')
      .set(header)
      .set('Content-Type', 'application/json')
      .send('{ not json ');
    expect(badJson.status).toBe(400);
    expect(badJson.body.code).toBe('invalid_json');

    const badSchema = await request(server())
      .post('/api/v1/_probe/echo')
      .set(header)
      .send({ name: 'way too long a name' });
    expect(badSchema.status).toBe(422);
    expect(badSchema.body.code).toBe('validation_failed');
    expect(badSchema.body.errors[0].path).toBe('name');
  });
});
