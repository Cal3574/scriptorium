import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

// Programmatic migrator - the production entrypoint (invoked by
// `scripts/migrate.mjs`, which the `scriptorium-migrate` bin and the
// `database:migrate` Nx target both call). Uses `drizzle-orm`'s `migrate()`
// (not `drizzle-kit`, a dev dependency), is idempotent, and tracks applied
// migrations in `drizzle.__drizzle_migrations`. A pre-deploy step runs this
// against the cluster Postgres before new api / worker pods roll; pods never
// migrate on boot.
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
