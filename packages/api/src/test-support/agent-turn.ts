import { type AgentEvent, parseAgentEventFrame } from '@scriptorium/contracts';
import request from 'supertest';
import type { TestDatabase } from './test-database';

// A book to hold an Agent thread. Unlike the RAG helper this plants no chapters
// or chunks - Agent mode has no retrieval, so a bare book is all a thread needs.
export async function plantAgentBook(
  db: TestDatabase,
  userId: string,
  title = 'On Uncertainty',
): Promise<string> {
  const book = await db.pool.query(
    `INSERT INTO books (user_id, title, original_filename, s3_key, status)
     VALUES ($1, $2, 'uncertainty.pdf', $3, 'ready')
     RETURNING id`,
    [userId, title, `books/${userId}/${title}.pdf`],
  );
  return book.rows[0].id as string;
}

export interface AgentTurnResult {
  status: number;
  contentType: string;
  text: string;
  events: AgentEvent[];
}

export interface TimedAgentTurnResult extends AgentTurnResult {
  // `Date.now()` when a chunk containing the `agent_done` frame was first
  // observed on the response's `data` event - an approximation of when the
  // reply became visible to a real client, distinct from when the HTTP
  // response itself finishes (`endAt`). Null if `agent_done` never arrived.
  doneObservedAt: number | null;
  // `Date.now()` once the response's `end` event has fired - i.e. once any
  // work the request handler does *after* its last `write()` has finished.
  endAt: number;
}

/**
 * `POST /api/v1/books/:bookId/agent-messages` over supertest, buffering the SSE
 * response body and parsing it into {@link AgentEvent}s (empty unless the
 * status is 200). A non-200 leaves `events` empty and the problem+json in
 * `text`.
 */
export async function sendAgentMessage(
  server: () => Parameters<typeof request>[0],
  header: { Authorization: string },
  bookId: string,
  body: Record<string, unknown>,
): Promise<AgentTurnResult> {
  const res = await request(server())
    .post(`/api/v1/books/${bookId}/agent-messages`)
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
  const events: AgentEvent[] = [];
  if (res.status === 200 && text) {
    for (const block of text.split('\n\n')) {
      const event = parseAgentEventFrame(block);
      if (event) events.push(event);
    }
  }
  return {
    status: res.status,
    contentType: res.headers['content-type'] ?? '',
    text,
    events,
  };
}

/**
 * Like {@link sendAgentMessage}, but also records when the `agent_done` frame
 * was first observed on the wire versus when the response actually ends -
 * see {@link TimedAgentTurnResult}. Used to verify context-window trimming
 * (#158) runs after the visible reply has already streamed, not before it.
 */
export async function sendAgentMessageTimed(
  server: () => Parameters<typeof request>[0],
  header: { Authorization: string },
  bookId: string,
  body: Record<string, unknown>,
): Promise<TimedAgentTurnResult> {
  let doneObservedAt: number | null = null;

  const res = await request(server())
    .post(`/api/v1/books/${bookId}/agent-messages`)
    .set(header)
    .set('Accept', 'text/event-stream')
    .buffer(true)
    .parse((response, cb) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        data += chunk;
        if (doneObservedAt === null && data.includes('event: agent_done')) {
          doneObservedAt = Date.now();
        }
      });
      response.on('end', () => cb(null, data));
    })
    .send(body);
  const endAt = Date.now();

  const text =
    typeof res.body === 'string' && res.body ? res.body : res.text || '';
  const events: AgentEvent[] = [];
  if (res.status === 200 && text) {
    for (const block of text.split('\n\n')) {
      const event = parseAgentEventFrame(block);
      if (event) events.push(event);
    }
  }
  return {
    status: res.status,
    contentType: res.headers['content-type'] ?? '',
    text,
    events,
    doneObservedAt,
    endAt,
  };
}

/**
 * Seeds `count` completed turns directly via SQL, bypassing the endpoint -
 * fast fixture setup for trimming tests, which need dozens of turns in place
 * before the turn under test. Each seeded row's `created_at` continues
 * strictly increasing (whole seconds apart) from whatever the thread's latest
 * row already is - starting a fresh past epoch for a brand-new thread, or
 * picking up from the last real row's timestamp for a thread a prior
 * {@link sendAgentMessage} call already wrote to. This is what lets seeded
 * fixture turns and endpoint-driven turns interleave in one test (build most
 * of a long thread cheaply via SQL, then cross the trim threshold for real)
 * without ever inverting the ordering trimming's boundary logic depends on.
 *
 * Returns the thread id; the seeded rows' `role`/`message` follow a
 * `turn <n> question` / `turn <n> answer` shape so a test can assert on which
 * ones survived into the next turn's prompt via the fake LLM's turn-count
 * echo. `n` is unique per row across the whole test (via `startIndex`) purely
 * for that readability - it plays no part in ordering.
 */
export async function seedAgentTurns(
  db: TestDatabase,
  userId: string,
  bookId: string,
  count: number,
  options: { seedPassage?: string; startIndex?: number } = {},
): Promise<string> {
  const startIndex = options.startIndex ?? 0;

  const existing = await db.pool.query(
    `SELECT id FROM agent_threads WHERE user_id = $1 AND book_id = $2`,
    [userId, bookId],
  );
  const threadId =
    (existing.rows[0]?.id as string | undefined) ??
    (
      await db.pool.query(
        `INSERT INTO agent_threads (user_id, book_id) VALUES ($1, $2) RETURNING id`,
        [userId, bookId],
      )
    ).rows[0].id;

  const latest = await db.pool.query(
    `SELECT MAX(created_at) AS latest FROM agent_messages WHERE thread_id = $1`,
    [threadId],
  );
  // Nothing in the thread yet: start comfortably in the past so these rows
  // are guaranteed to predate any real, wall-clock-stamped turn sent later in
  // the same test.
  let cursor: number = latest.rows[0].latest
    ? new Date(latest.rows[0].latest as string).getTime()
    : Date.UTC(2020, 0, 1);

  for (let i = 0; i < count; i++) {
    const n = startIndex + i;
    cursor += 1000;
    const userAt = new Date(cursor).toISOString();
    cursor += 1000;
    const assistantAt = new Date(cursor).toISOString();
    await db.pool.query(
      `INSERT INTO agent_messages (thread_id, role, message, highlighted_passage, created_at)
       VALUES ($1, 'user', $2, $3, $4)`,
      [
        threadId,
        `turn ${n} question`,
        n === 0 ? (options.seedPassage ?? null) : null,
        userAt,
      ],
    );
    await db.pool.query(
      `INSERT INTO agent_messages (thread_id, role, message, created_at)
       VALUES ($1, 'assistant', $2, $3)`,
      [threadId, `turn ${n} answer`, assistantAt],
    );
  }
  return threadId;
}
