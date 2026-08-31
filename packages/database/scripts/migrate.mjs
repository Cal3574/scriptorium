#!/usr/bin/env node
// Runnable entrypoint for the migrator. Registers the swc TypeScript loader,
// then hands off to `runMigrations` in ../src/migrate.ts. This is what the
// `scriptorium-migrate` bin and the `database:migrate` Nx target invoke -
// plain node needs no extra flags.
import '@swc-node/register/esm-register';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const { runMigrations } = await import('../src/migrate.ts');
await runMigrations(connectionString);
console.log('migrations up to date');
