// Development seed. No product tables yet, so this only proves connectivity
// and that migrations have run. Safe to run repeatedly.
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();
  const { rows } = await client.query('SELECT count(*)::int AS n FROM schema_migrations');
  console.log(`seed: ${rows[0].n} migration(s) applied, nothing to seed yet`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
