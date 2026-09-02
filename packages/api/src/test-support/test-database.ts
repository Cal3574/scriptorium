import { runMigrations } from '@scriptorium/database';
import pg from 'pg';

// Seam 1 tests run against a real Postgres + pgvector. To avoid ever touching
// dev data we point at a dedicated `<db>_test_api` database, creating it and
// applying the committed migrations on first use. The per-project suffix
// (`_api`, vs the worker helper's `_worker`) keeps the two integration suites
// `nx run-many` runs in parallel from truncating each other's rows mid-test.
const DB_SUFFIX = '_test_api';

export function testDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const url = new URL(raw);
  if (!url.pathname.endsWith(DB_SUFFIX)) {
    url.pathname = `${url.pathname.replace(/_test$/, '')}${DB_SUFFIX}`;
  }
  return url.toString();
}

export interface TestDatabase {
  url: string;
  pool: pg.Pool;
  truncateAll(): Promise<void>;
  close(): Promise<void>;
}

// A fixed advisory-lock key so the integration-test projects `nx run-many`
// starts in parallel (`database`, `worker`, `api`) serialise the one-time
// create + migrate of the shared `<db>_test` database instead of racing each
// other on `CREATE DATABASE` / the first migration.
const SETUP_LOCK_KEY = 823_741;

let migrated = false;

export async function setupTestDatabase(): Promise<TestDatabase> {
  const url = testDatabaseUrl();

  if (!migrated) {
    await withSetupLock(url, async () => {
      await ensureDatabaseExists(url);
      await runMigrations(url);
    });
    migrated = true;
  }

  const pool = new pg.Pool({ connectionString: url });
  return {
    url,
    pool,
    async truncateAll() {
      await pool.query(
        'TRUNCATE users, books, chapters, chunks, queries RESTART IDENTITY CASCADE',
      );
    },
    async close() {
      await pool.end();
    },
  };
}

// Run `fn` while holding a cluster-wide session advisory lock, taken on the
// `postgres` database. Advisory locks are shared across the whole instance
// regardless of the connected database, so this serialises setup across every
// test process.
async function withSetupLock(
  url: string,
  fn: () => Promise<void>,
): Promise<void> {
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SETUP_LOCK_KEY]);
    await fn();
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [SETUP_LOCK_KEY])
      .catch(() => undefined);
    await client.end();
  }
}

async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = target.pathname.replace(/^\//, '');
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (rowCount) return;
    try {
      await client.query(`CREATE DATABASE "${dbName}"`);
    } catch (err) {
      // 42P04 = duplicate_database: another runner created it between our
      // check and our create. Harmless.
      if ((err as { code?: string }).code !== '42P04') throw err;
    }
  } finally {
    await client.end();
  }
}
