import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type DbClient = NodePgDatabase<Schema>;

// The single entry point for opening a database connection. Every process that
// touches Postgres (api, worker, the seed script) goes through here so the
// pool config and the schema binding are defined once. The caller owns the
// pool lifecycle via `client.$client.end()` on shutdown.
export function createDbClient(connectionString: string): DbClient {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}
