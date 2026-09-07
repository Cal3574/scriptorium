import { parseQueryEventFrame, type QueryEvent } from '@scriptorium/contracts';
import { FakeEmbeddingClient } from '@scriptorium/providers';
import request from 'supertest';
import type { TestDatabase } from './test-database';

// A fixed question for RAG-query integration specs. The fake embedding client
// is deterministic per string, so a chunk stored with this question's vector
// sits at similarity 1.0 - comfortably above the retrieval floor.
export const RAG_QUESTION =
  'What do these authors say about acting under uncertainty?';

// The `vector` literal for a chunk that should match {@link RAG_QUESTION}.
export async function ragMatchVectorLiteral(): Promise<string> {
  const [vector] = await new FakeEmbeddingClient().embed([RAG_QUESTION]);
  return `[${vector.join(',')}]`;
}

/**
 * Plant a book + chapter + `count` embedded chunks under `userId`, each chunk's
 * stored vector equal to {@link RAG_QUESTION}'s. `userId` must already exist
 * (the auth guard provisions the row on the first authenticated call). Returns
 * the book id.
 */
export async function plantRagLibrary(
  db: TestDatabase,
  userId: string,
  matchVectorLiteral: string,
  count = 3,
): Promise<string> {
  const book = await db.pool.query(
    `INSERT INTO books (user_id, title, original_filename, s3_key, status)
     VALUES ($1, 'On Uncertainty', 'uncertainty.pdf', $2, 'ready')
     RETURNING id`,
    [userId, `books/${userId}/uncertainty.pdf`],
  );
  const bookId = book.rows[0].id as string;
  const chapter = await db.pool.query(
    `INSERT INTO chapters (book_id, chapter_index, title)
     VALUES ($1, 0, 'Chapter 1') RETURNING id`,
    [bookId],
  );
  const chapterId = chapter.rows[0].id as string;

  for (let i = 0; i < count; i++) {
    await db.pool.query(
      `INSERT INTO chunks
         (chapter_id, book_id, user_id, chunk_index, chunk_text,
          book_title, chapter_title, embedding)
       VALUES ($1, $2, $3, $4, $5, 'On Uncertainty', 'Chapter 1', $6::vector)`,
      [
        chapterId,
        bookId,
        userId,
        i,
        `Passage ${i}: on acting well without complete information.`,
        matchVectorLiteral,
      ],
    );
  }
  return bookId;
}

export interface AskResult {
  status: number;
  contentType: string;
  text: string;
  events: QueryEvent[];
}

/**
 * `POST /api/v1/queries` over supertest, buffering the SSE response body and
 * parsing it into {@link QueryEvent}s (empty unless the status is 200). A
 * non-200 leaves `events` empty and the problem+json in `text`.
 */
export async function askQuery(
  server: () => Parameters<typeof request>[0],
  header: { Authorization: string },
  body: Record<string, unknown>,
): Promise<AskResult> {
  const res = await request(server())
    .post('/api/v1/queries')
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
  const events: QueryEvent[] = [];
  if (res.status === 200 && text) {
    for (const block of text.split('\n\n')) {
      const event = parseQueryEventFrame(block);
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
