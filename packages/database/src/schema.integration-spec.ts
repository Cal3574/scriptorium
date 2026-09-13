import pg from 'pg';
import { createDbClient } from './client.js';
import {
  agentMessages,
  agentThreads,
  books,
  chapters,
  chunks,
  queries,
  users,
} from './schema/index.js';
import { eq } from 'drizzle-orm';

// Integration test: requires a live Postgres reachable via DATABASE_URL with
// migrations already applied (CI runs `database:migrate` first).
describe('@scriptorium/database schema', () => {
  let raw: pg.Client;
  let db: ReturnType<typeof createDbClient>;

  beforeAll(async () => {
    raw = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await raw.connect();
    db = createDbClient(process.env.DATABASE_URL as string);
  });

  afterAll(async () => {
    await raw.end();
    await (db as unknown as { $client: pg.Pool }).$client.end();
  });

  it('applied the migrations', async () => {
    const { rows } = await raw.query(
      "SELECT to_regclass('drizzle.__drizzle_migrations') AS t",
    );
    expect(rows[0].t).not.toBeNull();
  });

  it('enabled the pgvector extension', async () => {
    const { rows } = await raw.query(
      "SELECT 1 AS ok FROM pg_extension WHERE extname = 'vector'",
    );
    expect(rows[0]?.ok).toBe(1);
  });

  it('created every product table', async () => {
    const { rows } = await raw.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'agent_messages',
      'agent_threads',
      'books',
      'chapters',
      'chunks',
      'queries',
      'users',
    ]);
  });

  it('defines agent_message_role as a native enum with user and assistant', async () => {
    const { rows } = await raw.query(
      `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'agent_message_role' ORDER BY e.enumsortorder`,
    );
    expect(rows.map((r) => r.enumlabel)).toEqual(['user', 'assistant']);
  });

  it('has no citations column on agent_messages - Agent mode has no retrieval', async () => {
    const { rows } = await raw.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'agent_messages' ORDER BY column_name`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain('highlighted_passage');
    expect(columns).not.toContain('citations');
  });

  it('defines book_status as a native enum with the eight values', async () => {
    const { rows } = await raw.query(
      `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'book_status' ORDER BY e.enumsortorder`,
    );
    expect(rows.map((r) => r.enumlabel)).toEqual([
      'pending',
      'extracting',
      'chunking',
      'embedding',
      'summarizing',
      'ready',
      'failed',
      'deleting',
    ]);
  });

  it('has the partial HNSW cosine index on chunks.embedding', async () => {
    const { rows } = await raw.query(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'chunks_embedding_hnsw'",
    );
    expect(rows[0].indexdef).toMatch(/USING hnsw/);
    expect(rows[0].indexdef).toMatch(/vector_cosine_ops/);
    expect(rows[0].indexdef).toMatch(/WHERE \(embedding IS NOT NULL\)/i);
  });

  it('records the book_title drift comment', async () => {
    const { rows } = await raw.query(
      `SELECT col_description('chunks'::regclass, attnum) AS c
       FROM pg_attribute WHERE attrelid = 'chunks'::regclass AND attname = 'book_title'`,
    );
    expect(rows[0].c).toMatch(/drift/i);
  });

  it('cascades users -> books -> chapters -> chunks and SET NULLs queries.book_id', async () => {
    const [user] = await db
      .insert(users)
      .values({ clerkUserId: `test_${Date.now()}`, email: 't@example.com' })
      .returning();
    const [book] = await db
      .insert(books)
      .values({
        userId: user.id,
        originalFilename: 'x.pdf',
        s3Key: `books/${user.id}/x.pdf`,
      })
      .returning();
    const [chapter] = await db
      .insert(chapters)
      .values({ bookId: book.id, chapterIndex: 0 })
      .returning();
    await db.insert(chunks).values({
      chapterId: chapter.id,
      bookId: book.id,
      userId: user.id,
      chunkIndex: 0,
      chunkText: 'hello',
      bookTitle: 'X',
      chapterTitle: 'One',
    });
    const [query] = await db
      .insert(queries)
      .values({ userId: user.id, question: 'q?', bookId: book.id })
      .returning();

    await db.delete(books).where(eq(books.id, book.id));

    expect(
      await db.select().from(chapters).where(eq(chapters.bookId, book.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(chunks).where(eq(chunks.bookId, book.id)),
    ).toHaveLength(0);
    const [reloaded] = await db
      .select()
      .from(queries)
      .where(eq(queries.id, query.id));
    expect(reloaded.bookId).toBeNull();

    await db.delete(users).where(eq(users.id, user.id));
  });

  it('enforces one agent thread per (user, book) and cascades its messages', async () => {
    const [user] = await db
      .insert(users)
      .values({
        clerkUserId: `test_thread_${Date.now()}`,
        email: 'thread@example.com',
      })
      .returning();
    const [book] = await db
      .insert(books)
      .values({
        userId: user.id,
        originalFilename: 'y.pdf',
        s3Key: `books/${user.id}/y.pdf`,
      })
      .returning();
    const [thread] = await db
      .insert(agentThreads)
      .values({ userId: user.id, bookId: book.id })
      .returning();
    await db.insert(agentMessages).values({
      threadId: thread.id,
      role: 'user',
      message: 'why does this land so hard?',
      highlightedPassage: 'the passage',
    });

    await expect(
      db.insert(agentThreads).values({ userId: user.id, bookId: book.id }),
    ).rejects.toThrow();

    await db.delete(books).where(eq(books.id, book.id));

    expect(
      await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.threadId, thread.id)),
    ).toHaveLength(0);

    await db.delete(users).where(eq(users.id, user.id));
  });
});
