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
