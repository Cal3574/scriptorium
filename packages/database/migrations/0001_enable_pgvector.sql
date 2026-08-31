-- The database image ships pgvector; enable it so later migrations can use
-- the `vector` type. The schema_migrations bookkeeping table is owned by the
-- runner (scripts/migrate.mjs), not by a migration.
CREATE EXTENSION IF NOT EXISTS vector;
