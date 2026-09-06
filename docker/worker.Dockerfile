# syntax=docker/dockerfile:1.7
#
# Scriptorium worker - BullMQ consumer on the `ingest` queue. No HTTP server:
# probe it with an exec/liveness check, not httpGet.
# Build from the repo root:
#
#   docker build -f docker/worker.Dockerfile -t scriptorium/worker .
#
# NxAppWebpackPlugin bundles the workspace source but leaves npm packages as
# external `require(...)`, so the runtime image pairs the built `dist/` with a
# pruned, self-contained production `node_modules` produced by `pnpm deploy`.

ARG NODE_VERSION=22.22.0

# ---------------------------------------------------------------------------
# deps: restore the pnpm store. Re-runs only when a manifest or the lockfile
# changes.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true HUSKY=0
RUN corepack enable
WORKDIR /app

# Every workspace manifest must be present for `--frozen-lockfile` to resolve.
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
# build: webpack bundle + self-contained production tree for the worker.
# ---------------------------------------------------------------------------
FROM deps AS build
ENV NX_DAEMON=false NODE_ENV=production
COPY . .

# The build target already forces NODE_ENV=production (packages/worker/project.json).
RUN pnpm exec nx build worker

# Copies the just-built packages/worker/dist plus a production node_modules for
# the worker's dependency closure.
RUN pnpm --filter=@scriptorium/worker --prod deploy /prod/worker

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=build --chown=node:node /prod/worker ./

# enableShutdownHooks() in main.ts drains the queue on SIGTERM; tini reaps.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
