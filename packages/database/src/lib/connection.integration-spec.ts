import pg from 'pg';

// Integration test: requires a live Postgres (docker-compose or CI service
// container) reachable via DATABASE_URL, plus migrations applied.
describe('database connection', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('reaches Postgres', async () => {
    const { rows } = await client.query('SELECT 1 AS ok');
    expect(rows[0].ok).toBe(1);
  });

  it('has the pgvector extension available', async () => {
    const { rows } = await client.query(
      "SELECT 1 AS ok FROM pg_available_extensions WHERE name = 'vector'",
    );
    expect(rows[0]?.ok).toBe(1);
  });

  it('ran the migration bookkeeping table', async () => {
    const { rows } = await client.query('SELECT to_regclass($1) AS t', [
      'schema_migrations',
    ]);
    expect(rows[0].t).toBe('schema_migrations');
  });
});
