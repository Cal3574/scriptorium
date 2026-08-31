// Minimal forward-only migration runner. Applies every *.sql file in
// ../migrations in filename order, once, tracked in schema_migrations.
// Plain .mjs so it runs under node with no build step.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClient } from './db-client.mjs';

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

await withClient(async (client) => {
  // The runner owns its own bookkeeping table - it is not a migration.
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, run_at timestamptz NOT NULL DEFAULT now())',
  );
  const { rows } = await client.query('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.id));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [
        file,
      ]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  console.log('migrations up to date');
});
