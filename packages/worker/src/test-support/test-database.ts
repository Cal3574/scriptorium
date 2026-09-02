import { runMigrations } from '@scriptorium/database';
import pg from 'pg';

// Seam-2 tests run against a real Postgres + pgvector, on a sibling
// `<db>_test` database created and migrated on first use so dev data is never
// touched. Mirrors the api's test-support helper (cross-app import is banned
// by the module-boundary rules, so the small helper is duplicated).
export function testDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const url = new URL(raw);
  if (!url.pathname.endsWith('_test')) {
    url.pathname = `${url.pathname}_test`;
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
