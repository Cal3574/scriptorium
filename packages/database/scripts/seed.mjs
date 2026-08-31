// Development seed. No product tables yet, so this only proves connectivity
// and that migrations have run. Safe to run repeatedly.
import { withClient } from './db-client.mjs';

await withClient(async (client) => {
  const { rows } = await client.query(
    'SELECT count(*)::int AS n FROM schema_migrations',
  );
  console.log(`seed: ${rows[0].n} migration(s) applied, nothing to seed yet`);
});
