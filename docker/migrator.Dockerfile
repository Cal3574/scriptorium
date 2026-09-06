# syntax=docker/dockerfile:1.7
#
# Scriptorium migrator - runs drizzle migrations against the cluster Postgres.
# Build from the repo root:
#
#   docker build -f docker/migrator.Dockerfile -t scriptorium/migrator .
#
# Run it as a pre-deploy Job (or an initContainer) BEFORE the api/worker pods
# roll. Idempotent - drizzle tracks applied migrations in
# drizzle.__drizzle_migrations; pods never migrate on boot. Needs DATABASE_URL.
#
# packages/database/src/migrate.ts is compiled to plain JS at build time (one
# self-contained file - it imports only drizzle-orm, pg and node builtins), so
# the runtime needs neither a TypeScript loader nor the workspace tsconfigs.

ARG NODE_VERSION=22.22.0

# ---------------------------------------------------------------------------
# deps: restore the pnpm store.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true HUSKY=0
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY packages/api/package.json         packages/api/
COPY packages/client/package.json      packages/client/
COPY packages/config/package.json      packages/config/
COPY packages/contracts/package.json   packages/contracts/
COPY packages/database/package.json    packages/database/
COPY packages/providers/package.json   packages/providers/
COPY packages/server-core/package.json packages/server-core/
COPY packages/worker/package.json      packages/worker/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build: compile migrate.ts, carve out the production database package, and
# generate the runner entrypoint.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .

# production node_modules (drizzle-orm, pg) + migrations/ + package files.
RUN pnpm --filter=@scriptorium/database --prod deploy /prod/migrator

# One-file transpile - no tsconfig, no path aliases in this module.
RUN pnpm exec tsc packages/database/src/migrate.ts \
      --ignoreConfig --module nodenext --moduleResolution nodenext \
      --target es2022 --skipLibCheck --outDir /prod/migrator/dist

# Runner: migrationsFolder resolves to /prod/migrator/migrations (dist/../migrations).
RUN printf '%s\n' \
      "import { runMigrations } from './dist/migrate.js';" \
      "const url = process.env.DATABASE_URL;" \
      "if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }" \
      "await runMigrations(url);" \
      "console.log('migrations up to date');" \
      > /prod/migrator/run.mjs

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=build --chown=node:node /prod/migrator ./

CMD ["node", "run.mjs"]
