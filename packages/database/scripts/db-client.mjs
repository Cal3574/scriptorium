import pg from 'pg';

// Shared bootstrap for the migrate/seed scripts: resolve DATABASE_URL, hand
// back a connected client, and guarantee it is closed once `run` settles.
export async function withClient(run) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await run(client);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
