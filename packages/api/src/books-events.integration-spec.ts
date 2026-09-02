import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  bookEventsChannel,
  bookEventsSeqKey,
  type IngestEvent,
} from '@scriptorium/contracts';
import { Redis } from 'ioredis';
import { createTestApp } from './test-support/create-test-app';
import {
  createTestAuthority,
  type TestAuthority,
} from './test-support/rsa-jwt';
import {
  setupTestDatabase,
  type TestDatabase,
} from './test-support/test-database';

const REDIS_URL = 'redis://localhost:6379';

// Seam: the real api app + real Postgres + real Redis. The worker is not
// running, so the test plays the worker - it INCRs the per-book seq and
// PUBLISHes stage events exactly as `StageEventPublisher` does - and asserts
// the endpoint bridges them to the browser correctly.
describe('live ingest progress over SSE', () => {
  let db: TestDatabase;
  let auth: TestAuthority;
  let app: INestApplication;
  let redis: Redis;
  let baseUrl: string;

  const clerkUser = { clerkUserId: 'user_sse', email: 'sse@example.com' };

  beforeAll(async () => {
    db = await setupTestDatabase();
    auth = createTestAuthority();
    app = await createTestApp({ jwtKey: auth.jwtKey, databaseUrl: db.url });
    await (app as NestExpressApplication).listen(0);
    baseUrl = await app.getUrl();
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  });

  afterAll(async () => {
    await redis.quit();
    await app.close();
    await db.close();
  });

  beforeEach(async () => {
    await db.truncateAll();
  });

  function tokenFor(user = clerkUser): string {
    return auth.authHeaderFor(user).Authorization.replace(/^Bearer /, '');
  }

  async function seedBook(
    opts: { ownerClerkId?: string; status?: string } = {},
  ) {
    const [owner] = (
      await db.pool.query(
        `INSERT INTO users (id, clerk_user_id, email) VALUES ($1, $2, $3) RETURNING id`,
        [
          randomUUID(),
          opts.ownerClerkId ?? clerkUser.clerkUserId,
          `${opts.ownerClerkId ?? 'sse'}@example.com`,
        ],
      )
    ).rows;
    const bookId = randomUUID();
    await db.pool.query(
      `INSERT INTO books (id, user_id, original_filename, s3_key, file_size_bytes, status)
       VALUES ($1, $2, 'b.pdf', $3, 10, $4)`,
      [
        bookId,
        owner.id,
        `books/${owner.id}/${bookId}.pdf`,
        opts.status ?? 'pending',
      ],
    );
    return bookId;
  }

  async function publish(
    bookId: string,
    event: Record<string, unknown> & { type: IngestEvent['type'] },
  ) {
    const seq = await redis.incr(bookEventsSeqKey(bookId));
    await redis.publish(
      bookEventsChannel(bookId),
      JSON.stringify({ ...event, bookId, seq }),
    );
    return seq;
  }

  interface OpenStream {
    frames: string[];
    events: () => Array<{ event: string; data: IngestEvent }>;
    waitFor: (type: string, ms?: number) => Promise<IngestEvent>;
    close: () => void;
    closed: () => boolean;
  }

  async function openStream(
    bookId: string,
    token: string,
  ): Promise<{
    status: number;
    contentType: string | null;
    stream?: OpenStream;
  }> {
    const controller = new AbortController();
    const res = await fetch(
      `${baseUrl}/api/v1/books/${bookId}/events?token=${encodeURIComponent(token)}`,
      { headers: { Accept: 'text/event-stream' }, signal: controller.signal },
    );
    if (!res.ok || !res.body) {
      controller.abort();
      return {
        status: res.status,
        contentType: res.headers.get('content-type'),
      };
    }

    const frames: string[] = [];
    let done = false;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    void (async () => {
      try {
        for (;;) {
          const { value, done: rd } = await reader.read();
          if (rd) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            frames.push(buffer.slice(0, idx));
            buffer = buffer.slice(idx + 2);
          }
        }
      } catch {
        /* aborted */
      } finally {
        done = true;
      }
    })();

    const parseFrames = () =>
      frames
        .filter((f) => f.startsWith('event:'))
        .map((f) => {
          const event = /event: (.*)/.exec(f)?.[1] ?? '';
          const data = /data: (.*)/.exec(f)?.[1] ?? '{}';
          return { event, data: JSON.parse(data) as IngestEvent };
        });

    return {
      status: res.status,
      contentType: res.headers.get('content-type'),
      stream: {
        frames,
        events: parseFrames,
        closed: () => done,
        close: () => controller.abort(),
        async waitFor(type, ms = 3000) {
          const deadline = Date.now() + ms;
          for (;;) {
            const hit = parseFrames().find((e) => e.event === type);
            if (hit) return hit.data;
            if (Date.now() > deadline) {
              throw new Error(
                `timed out waiting for "${type}"; saw ${parseFrames()
                  .map((e) => e.event)
                  .join(', ')}`,
              );
            }
            await new Promise((r) => setTimeout(r, 25));
          }
        },
      },
    };
  }

  function requireStream(opened: {
    status: number;
    stream?: OpenStream;
  }): OpenStream {
    if (!opened.stream) {
      throw new Error(`expected an open stream, got HTTP ${opened.status}`);
    }
    return opened.stream;
  }

  it('rejects a connection with no token as 401', async () => {
    const bookId = await seedBook();
    const res = await openStream(bookId, '');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token as 401', async () => {
    const bookId = await seedBook();
    const res = await openStream(bookId, 'not-a-jwt');
    expect(res.status).toBe(401);
  });

  it("returns an identical 404 for another user's book", async () => {
    const bookId = await seedBook({ ownerClerkId: 'user_other' });
    const res = await openStream(bookId, tokenFor());
    expect(res.status).toBe(404);
  });

  it('leads with a snapshot built from the DB row, then streams deltas in seq order', async () => {
    const bookId = await seedBook({ status: 'extracting' });
    const opened = await openStream(bookId, tokenFor());
    expect(opened.status).toBe(200);
    expect(opened.contentType).toContain('text/event-stream');
    const s = requireStream(opened);

    const snapshot = await s.waitFor('snapshot');
    expect(snapshot).toMatchObject({
      type: 'snapshot',
      status: 'extracting',
      seq: 0,
    });

    await publish(bookId, {
      type: 'stage_entered',
      stage: 'extracting',
      status: 'extracting',
    });
    await publish(bookId, {
      type: 'book_identified',
      title: 'The Quiet Craft',
      author: null,
    });

    const identified = await s.waitFor('book_identified');
    expect(identified).toMatchObject({ seq: 2, title: 'The Quiet Craft' });

    const seqs = s.events().map((e) => e.data.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    s.close();
  });

  it('drops events already covered by the snapshot after a reconnect', async () => {
    const bookId = await seedBook({ status: 'extracting' });
    // Pipeline already emitted two events before the client connects.
    await publish(bookId, {
      type: 'stage_entered',
      stage: 'extracting',
      status: 'extracting',
    });
    await publish(bookId, {
      type: 'book_identified',
      title: 'T',
      author: null,
    });

    const opened = await openStream(bookId, tokenFor());
    const s = requireStream(opened);
    const snapshot = await s.waitFor('snapshot');
    expect(snapshot.seq).toBe(2);

    await publish(bookId, {
      type: 'stage_progress',
      stage: 'embedding',
      done: 1,
      total: 4,
      unit: 'chunks',
    });
    const progress = await s.waitFor('stage_progress');
    expect(progress.seq).toBe(3);
    // Nothing with seq <= 2 was replayed.
    expect(
      s.events().every((e) => e.event === 'snapshot' || e.data.seq > 2),
    ).toBe(true);
    s.close();
  });

  it('emits book_completed and closes the stream', async () => {
    const bookId = await seedBook({ status: 'summarizing' });
    const opened = await openStream(bookId, tokenFor());
    const s = requireStream(opened);
    await s.waitFor('snapshot');

    await publish(bookId, { type: 'book_completed', status: 'ready' });
    await s.waitFor('book_completed');

    await new Promise((r) => setTimeout(r, 200));
    expect(s.closed()).toBe(true);
  });

  it('emits book_deleted on the next keep-alive after the row is deleted', async () => {
    const bookId = await seedBook({ status: 'extracting' });
    const opened = await openStream(bookId, tokenFor());
    const s = requireStream(opened);
    await s.waitFor('snapshot');

    await db.pool.query('DELETE FROM books WHERE id = $1', [bookId]);
    const deleted = await s.waitFor('book_deleted', 5000);
    expect(deleted.type).toBe('book_deleted');

    await new Promise((r) => setTimeout(r, 200));
    expect(s.closed()).toBe(true);
  });
});
