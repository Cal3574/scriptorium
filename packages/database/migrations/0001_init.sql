-- 0001_init.sql
-- Bookkeeping table for the migration runner. No product schema yet.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id   text PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now()
);
