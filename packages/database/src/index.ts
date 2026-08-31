// @scriptorium/database owns all Postgres access: the connection pool, the
// Drizzle schema, migrations, seed data and typed query helpers. Nothing else
// in the workspace opens a database connection directly. Framework-free -
// `server-core` wraps it in a Nest module; `providers` may not import it.

export { createDbClient, type DbClient, type Schema } from './client.js';
export { runMigrations } from './migrate.js';
export * as schema from './schema/index.js';
export {
  bookStatus,
  books,
  chapters,
  chunks,
  queries,
  users,
} from './schema/index.js';
