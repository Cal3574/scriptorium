import type { INestApplication } from '@nestjs/common';
import { ActivityDto } from '@scriptorium/contracts';
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

// `GET /api/v1/me/activity` over the real Nest app + Postgres, booted with the
// shipped DEFAULT_PLAN_LIMITS. Every figure is derived from seeded rows.
describe('activity endpoint', () => {
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

  async function insertBook(
    uid: string,
    opts: {
      key: string;
      filename?: string;
      title?: string | null;
      status?: string;
      pageCount?: number | null;
      createdAt?: Date;
    },
  ): Promise<string> {
    const res = await db.pool.query(
      `INSERT INTO books (user_id, original_filename, title, s3_key, status, page_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))
       RETURNING id`,
      [
        uid,
        opts.filename ?? `${opts.key}.pdf`,
        opts.title ?? null,
        `books/${uid}/${opts.key}.pdf`,
        opts.status ?? 'ready',
        opts.pageCount ?? null,
        opts.createdAt ?? null,
      ],
    );
    return res.rows[0].id as string;
  }

  async function insertQuery(
    uid: string,
    opts: {
      bookId?: string | null;
      answer?: string | null;
      createdAt?: Date;
    } = {},
  ): Promise<void> {
    await db.pool.query(
      `INSERT INTO queries (user_id, question, answer, book_id, created_at)
       VALUES ($1, 'q', $2, $3, COALESCE($4, now()))`,
      [uid, opts.answer ?? null, opts.bookId ?? null, opts.createdAt ?? null],
    );
  }

  function monthsAgo(n: number): Date {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 15, 12),
    );
  }

  const getActivity = (header: { Authorization: string }) =>
    request(server()).get('/api/v1/me/activity').set(header);

  it('returns the ActivityDto shape with zero-filled 12-month series for a new reader', async () => {
    const header = headerFor('act_new', 'free');
    await userId(header);

    const res = await getActivity(header);
    expect(res.status).toBe(200);
    const activity = ActivityDto.parse(res.body);

    expect(activity.totals).toEqual({
      books: 0,
      questions: 0,
      pagesIngested: 0,
    });
    expect(activity.monthly).toHaveLength(12);
    expect(activity.monthly.every((m) => m.books === 0 && m.questions === 0)).toBe(
      true,
    );
    expect(activity.topBooks).toEqual([]);
    expect(activity.plan).toMatchObject({
      plan: 'free',
      questionsUsed: 0,
      questionsLimit: 20,
    });
  });

  it('lifetime totals count every book status and every query, and sum page_count', async () => {
    const header = headerFor('act_totals', 'pro');
    const uid = await userId(header);
    await insertBook(uid, { key: 'a', status: 'ready', pageCount: 100 });
    await insertBook(uid, { key: 'b', status: 'failed', pageCount: 50 });
    await insertBook(uid, { key: 'c', status: 'pending', pageCount: null });
    await insertQuery(uid, { answer: 'done' });
    await insertQuery(uid, { answer: null }); // failed synthesis still counts

    const activity = ActivityDto.parse((await getActivity(header)).body);
    expect(activity.totals).toEqual({
      books: 3,
      questions: 2,
      pagesIngested: 150,
    });
  });

  it('buckets uploads and questions by UTC month and excludes rows older than the window', async () => {
    const header = headerFor('act_series', 'pro');
    const uid = await userId(header);

    await insertBook(uid, { key: 'now1', createdAt: monthsAgo(0) });
    await insertBook(uid, { key: 'now2', createdAt: monthsAgo(0) });
    await insertBook(uid, { key: 'old', createdAt: monthsAgo(13) }); // outside window
    await insertQuery(uid, { createdAt: monthsAgo(1) });
    await insertQuery(uid, { createdAt: monthsAgo(1) });
    await insertQuery(uid, { createdAt: monthsAgo(1) });

    const activity = ActivityDto.parse((await getActivity(header)).body);
    const current = activity.monthly[11];
    const prev = activity.monthly[10];
    expect(current.books).toBe(2);
    expect(prev.questions).toBe(3);
    // The 13-months-ago upload lands in no bucket.
    const totalBooksInSeries = activity.monthly.reduce(
      (sum, m) => sum + m.books,
      0,
    );
    expect(totalBooksInSeries).toBe(2);
  });

  it('ranks top books by question count, breaking ties by most recent question', async () => {
    const header = headerFor('act_top', 'pro');
    const uid = await userId(header);
    const deep = await insertBook(uid, { key: 'deep', title: 'Deep Work' });
    const atomic = await insertBook(uid, { key: 'atomic', title: 'Atomic Habits' });
    const range = await insertBook(uid, { key: 'range', title: 'Range' });

    await insertQuery(uid, { bookId: deep, createdAt: monthsAgo(2) });
    await insertQuery(uid, { bookId: deep, createdAt: monthsAgo(2) });
    // atomic ties deep on count but has a more recent question
    await insertQuery(uid, { bookId: atomic, createdAt: monthsAgo(3) });
    await insertQuery(uid, { bookId: atomic, createdAt: monthsAgo(0) });
    await insertQuery(uid, { bookId: range });
    await insertQuery(uid, { bookId: null }); // unfiltered - excluded

    const activity = ActivityDto.parse((await getActivity(header)).body);
    expect(activity.topBooks.map((b) => b.title)).toEqual([
      'Atomic Habits',
      'Deep Work',
      'Range',
    ]);
    expect(activity.topBooks[0]).toMatchObject({
      bookId: atomic,
      questionCount: 2,
    });
  });

  it('drops questions whose book was deleted and falls back to the filename for an untitled book', async () => {
    const header = headerFor('act_deleted', 'pro');
    const uid = await userId(header);
    const kept = await insertBook(uid, {
      key: 'kept',
      title: null,
      filename: 'untitled-book.pdf',
    });
    const doomed = await insertBook(uid, { key: 'doomed', title: 'Doomed' });
    await insertQuery(uid, { bookId: kept });
    await insertQuery(uid, { bookId: doomed });
    await insertQuery(uid, { bookId: doomed });

    // Deleting the book nulls its queries' book_id (schema: onDelete set null).
    await db.pool.query(`DELETE FROM books WHERE id = $1`, [doomed]);

    const activity = ActivityDto.parse((await getActivity(header)).body);
    expect(activity.topBooks).toEqual([
      { bookId: kept, title: 'untitled-book.pdf', questionCount: 1 },
    ]);
  });

  it('caps the top-books list at five', async () => {
    const header = headerFor('act_cap', 'pro');
    const uid = await userId(header);
    for (let i = 0; i < 7; i++) {
      const b = await insertBook(uid, { key: `b${i}`, title: `Book ${i}` });
      for (let q = 0; q <= i; q++) await insertQuery(uid, { bookId: b });
    }
    const activity = ActivityDto.parse((await getActivity(header)).body);
    expect(activity.topBooks).toHaveLength(5);
    expect(activity.topBooks[0].title).toBe('Book 6');
  });

  it('applies Pro ceilings and a next-UTC-month reset instant', async () => {
    const header = headerFor('act_pro', 'pro');
    await userId(header);
    const activity = ActivityDto.parse((await getActivity(header)).body);
    expect(activity.plan.questionsLimit).toBe(1000);
    const at = new Date(activity.plan.resetsAt);
    expect(at.getUTCDate()).toBe(1);
    expect(at.getUTCHours()).toBe(0);
    expect(at.getTime()).toBeGreaterThan(Date.now());
  });

  it('is not quota-guarded: a reader over their ceiling still gets 200', async () => {
    const header = headerFor('act_over', 'free');
    const uid = await userId(header);
    for (let i = 0; i < 25; i++) await insertQuery(uid);
    const res = await getActivity(header);
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({ questionsUsed: 25, questionsLimit: 20 });
  });

  it('scopes every figure to the calling reader', async () => {
    const mine = headerFor('act_mine', 'pro');
    const theirs = headerFor('act_theirs', 'pro');
    const myUid = await userId(mine);
    const theirUid = await userId(theirs);
    const myBook = await insertBook(myUid, { key: 'mine', title: 'Mine' });
    await insertQuery(myUid, { bookId: myBook });
    const theirBook = await insertBook(theirUid, { key: 'theirs' });
    await insertQuery(theirUid, { bookId: theirBook });
    await insertQuery(theirUid);

    const activity = ActivityDto.parse((await getActivity(mine)).body);
    expect(activity.totals).toMatchObject({ books: 1, questions: 1 });
    expect(activity.topBooks).toEqual([
      { bookId: myBook, title: 'Mine', questionCount: 1 },
    ]);
  });

  it('rejects a no-token request with 401', async () => {
    const res = await request(server()).get('/api/v1/me/activity');
    expect(res.status).toBe(401);
  });
});
