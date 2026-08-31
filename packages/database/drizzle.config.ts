import { defineConfig } from 'drizzle-kit';

// drizzle-kit reads this for `generate` (emit a numbered SQL file from a
// schema change) and `check` (CI drift guard: schema vs migrations must
// agree). It never applies migrations - that is `src/migrate.ts`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
