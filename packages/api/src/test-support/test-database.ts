import { runMigrations } from '@scriptorium/database';
import pg from 'pg';

// Seam 1 tests run against a real Postgres + pgvector. To avoid ever touching
// dev data we point at a sibling `<db>_test_api` database, creating it and
// applying the committed migrations on first use. The suffix is app-specific:
// `nx run-many -t test-integration` runs the api and worker suites in parallel
// and each `truncateAll`s between tests, so they must not share one database.
const TEST_DB_SUFFIX = '_test_api';

export function testDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const url = new URL(raw);
  if (!url.pathname.endsWith(TEST_DB_SUFFIX)) {
    url.pathname = `${url.pathname}${TEST_DB_SUFFIX}`;
  }
  return url.toString();
}

export interface TestDatabase {
  url: string;
  pool: pg.Pool;
  truncateAll(): Promise<void>;
  close(): Promise<void>;
}

let migrated = false;

export async function setupTestDatabase(): Promise<TestDatabase> {
  const url = testDatabaseUrl();

  if (!migrated) {
    await ensureDatabaseExists(url);
    await runMigrations(url);
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
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }
}
