import type { INestApplication } from '@nestjs/common';
import type { AgentEvent } from '@scriptorium/contracts';
import { FAKE_LLM_FAILURE_MARKER } from '@scriptorium/providers';
import request from 'supertest';
import { plantAgentBook, sendAgentMessage } from './test-support/agent-turn';
import { createTestApp } from './test-support/create-test-app';
import {
  createTestAuthority,
  type TestAuthority,
} from './test-support/rsa-jwt';
import {
  setupTestDatabase,
  type TestDatabase,
} from './test-support/test-database';

// The Agent backend seam: `POST /api/v1/books/:bookId/agent-messages` and
// `GET .../agent-thread` against the real Nest app + real Postgres, with the
// fake LLM bound by `PROVIDER_MODE=fake`. Asserts thread find-or-create, the
// SSE event contract, and the turn/failure persistence semantics.
describe('agent conversation backend', () => {
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

  const PASSAGE =
    'The question is not whether you will be wrong, but how cheaply.';

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

  // Resolve the caller's user id (the auth guard provisions the row on the
  // first authenticated call).
  async function userId(header: { Authorization: string }): Promise<string> {
    const me = await request(server())
      .get('/api/v1/me')
      .set(header)
      .expect(200);
    return me.body.id as string;
  }

  async function plantBook(header: {
    Authorization: string;
  }): Promise<string> {
    return plantAgentBook(db, await userId(header));
  }

  const send = (
    header: { Authorization: string },
    bookId: string,
    body: Record<string, unknown>,
  ) => sendAgentMessage(server, header, bookId, body);

  const readThread = (header: { Authorization: string }, bookId: string) =>
    request(server())
      .get(`/api/v1/books/${bookId}/agent-thread`)
      .set(header);

  const doneEvent = (events: AgentEvent[]) =>
    events.find(
      (e): e is Extract<AgentEvent, { type: 'agent_done' }> =>
        e.type === 'agent_done',
    );
  const startedEvent = (events: AgentEvent[]) =>
    events.find(
      (e): e is Extract<AgentEvent, { type: 'agent_turn_started' }> =>
        e.type === 'agent_turn_started',
    );

  describe('a seeded first turn', () => {
    it('streams agent_turn_started, agent_text_delta+, agent_done in order', async () => {
      const bookId = await plantBook(alice());
      const { status, events } = await send(alice(), bookId, {
        message: 'why does this land so hard?',
        highlightedPassage: PASSAGE,
      });

      expect(status).toBe(200);
      const types = events.map((e) => e.type);
      expect(types[0]).toBe('agent_turn_started');
      expect(types[types.length - 1]).toBe('agent_done');
      expect(types.slice(1, -1).every((t) => t === 'agent_text_delta')).toBe(
        true,
      );
      expect(types).toContain('agent_text_delta');
    });

    it('concatenated deltas equal agent_done.message', async () => {
      const bookId = await plantBook(alice());
      const { events } = await send(alice(), bookId, {
        message: 'why does this land so hard?',
        highlightedPassage: PASSAGE,
      });

      const streamed = events
        .filter(
          (e): e is Extract<AgentEvent, { type: 'agent_text_delta' }> =>
            e.type === 'agent_text_delta',
        )
        .map((e) => e.text)
        .join('');
      expect(streamed).toBe(doneEvent(events)?.message);
    });

    it('creates the thread and persists both the user and assistant rows', async () => {
      const bookId = await plantBook(alice());
      const { events } = await send(alice(), bookId, {
        message: 'why does this land so hard?',
        highlightedPassage: PASSAGE,
      });

      const started = startedEvent(events);
      const done = doneEvent(events);

      const threads = await db.pool.query(
        `SELECT id, user_id, book_id FROM agent_threads`,
      );
      expect(threads.rows).toHaveLength(1);
      expect(threads.rows[0].id).toBe(started?.threadId);
      expect(threads.rows[0].book_id).toBe(bookId);

      const messages = await db.pool.query(
        `SELECT id, thread_id, role, message, highlighted_passage
         FROM agent_messages ORDER BY created_at, id`,
      );
      expect(messages.rows).toHaveLength(2);
      expect(messages.rows[0]).toEqual(
        expect.objectContaining({
          id: started?.userMessageId,
          thread_id: started?.threadId,
          role: 'user',
          message: 'why does this land so hard?',
          highlighted_passage: PASSAGE,
        }),
      );
      expect(messages.rows[1]).toEqual(
        expect.objectContaining({
          id: done?.messageId,
          role: 'assistant',
          message: done?.message,
          // Structurally separate from the message text, and never set on an
          // assistant row.
          highlighted_passage: null,
        }),
      );
    });

    it('reuses the same thread for a second turn on the same book', async () => {
      const bookId = await plantBook(alice());
      const first = await send(alice(), bookId, {
        message: 'why does this land so hard?',
        highlightedPassage: PASSAGE,
      });
      const second = await send(alice(), bookId, { message: 'say more' });

      expect(startedEvent(second.events)?.threadId).toBe(
        startedEvent(first.events)?.threadId,
      );
      const { rows } = await db.pool.query(`SELECT id FROM agent_threads`);
      expect(rows).toHaveLength(1);
    });

    it('keeps a separate thread per book', async () => {
      const id = await userId(alice());
      const first = await plantAgentBook(db, id, 'On Uncertainty');
      const second = await plantAgentBook(db, id, 'On Attention');

      await send(alice(), first, { message: 'a', highlightedPassage: PASSAGE });
      await send(alice(), second, { message: 'b', highlightedPassage: PASSAGE });

      const { rows } = await db.pool.query(
        `SELECT book_id FROM agent_threads ORDER BY created_at`,
      );
      expect(rows.map((r) => r.book_id)).toEqual([first, second]);
    });

    it('replays prior turns, so the companion answers differently on turn two', async () => {
      const bookId = await plantBook(alice());
      const first = await send(alice(), bookId, {
        message: 'why does this land so hard?',
        highlightedPassage: PASSAGE,
      });
      const second = await send(alice(), bookId, {
        message: 'why does this land so hard?',
        highlightedPassage: PASSAGE,
      });

      expect(doneEvent(second.events)?.message).not.toBe(
        doneEvent(first.events)?.message,
      );
    });
  });

  describe('a failed turn', () => {
    it('leaves the user message persisted with no assistant reply', async () => {
      const bookId = await plantBook(alice());
      const { status, events } = await send(alice(), bookId, {
        message: FAKE_LLM_FAILURE_MARKER,
        highlightedPassage: PASSAGE,
      });

      // The stream is already open by the time generation fails, so the
      // failure is an event, not an HTTP status.
      expect(status).toBe(200);
      expect(events.map((e) => e.type)).toEqual([
        'agent_turn_started',
        'agent_error',
      ]);

      const { rows } = await db.pool.query(
        `SELECT role, message FROM agent_messages ORDER BY created_at, id`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          role: 'user',
          message: FAKE_LLM_FAILURE_MARKER,
        }),
      );
    });

    it('is skipped when the next turn reassembles history', async () => {
      const bookId = await plantBook(alice());
      await send(alice(), bookId, {
        message: 'first',
        highlightedPassage: PASSAGE,
      });
      await send(alice(), bookId, { message: FAKE_LLM_FAILURE_MARKER });
      const retry = await send(alice(), bookId, { message: 'second' });

      // The fake companion reports how many completed turns it was replayed.
      // One - the failed turn contributed no user/assistant pair.
      expect(doneEvent(retry.events)?.message).toContain('turn 2');

      const { rows } = await db.pool.query(
        `SELECT role FROM agent_messages ORDER BY created_at, id`,
      );
      expect(rows.map((r) => r.role)).toEqual([
        'user',
        'assistant',
        'user',
        'user',
        'assistant',
      ]);
    });
  });

  describe('reading a thread', () => {
    it('returns an empty conversation for a book with no thread, creating nothing', async () => {
      const bookId = await plantBook(alice());
      const res = await readThread(alice(), bookId).expect(200);

      expect(res.body).toEqual({
        id: null,
        bookId,
        createdAt: null,
        messages: [],
      });
      const { rows } = await db.pool.query(`SELECT id FROM agent_threads`);
      expect(rows).toHaveLength(0);
    });

    it('returns every message oldest first, failed turns included', async () => {
      const bookId = await plantBook(alice());
      await send(alice(), bookId, {
        message: 'why does this land so hard?',
        highlightedPassage: PASSAGE,
      });
      await send(alice(), bookId, { message: FAKE_LLM_FAILURE_MARKER });

      const res = await readThread(alice(), bookId).expect(200);
      expect(res.body.id).not.toBeNull();
      expect(
        res.body.messages.map(
          (m: { role: string; highlightedPassage: string | null }) => [
            m.role,
            m.highlightedPassage,
          ],
        ),
      ).toEqual([
        ['user', PASSAGE],
        ['assistant', null],
        ['user', null],
      ]);
      // No citations field anywhere - Agent mode has no retrieval.
      expect(res.body.messages[0]).not.toHaveProperty('citations');
    });
  });

  describe('guards before the stream opens', () => {
    it('404s a foreign book on both send and read', async () => {
      const bobsBook = await plantBook(bob());
      await userId(alice());

      const sent = await send(alice(), bobsBook, { message: 'hello' });
      expect(sent.status).toBe(404);
      expect(JSON.parse(sent.text).code).toBe('book_not_found');

      const read = await readThread(alice(), bobsBook).expect(404);
      expect(read.body.code).toBe('book_not_found');

      const { rows } = await db.pool.query(`SELECT id FROM agent_threads`);
      expect(rows).toHaveLength(0);
    });

    it('422s an over-length message and writes nothing', async () => {
      const bookId = await plantBook(alice());
      const res = await send(alice(), bookId, { message: 'x'.repeat(2001) });

      expect(res.status).toBe(422);
      expect(JSON.parse(res.text).code).toBe('agent_message_too_long');
      const { rows } = await db.pool.query(`SELECT id FROM agent_messages`);
      expect(rows).toHaveLength(0);
    });

    it('422s an over-length highlighted passage', async () => {
      const bookId = await plantBook(alice());
      const res = await send(alice(), bookId, {
        message: 'ok',
        highlightedPassage: 'x'.repeat(4001),
      });

      expect(res.status).toBe(422);
      expect(JSON.parse(res.text).code).toBe('highlighted_passage_too_long');
    });

    it('422s an empty message', async () => {
      const bookId = await plantBook(alice());
      const res = await send(alice(), bookId, { message: '' });
      expect(res.status).toBe(422);
    });
  });
});
