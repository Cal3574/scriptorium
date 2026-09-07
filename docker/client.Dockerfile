# syntax=docker/dockerfile:1.7
#
# Scriptorium client - Vite SPA, built to static files and served by nginx.
# Build from the repo root:
#
#   docker build -f docker/client.Dockerfile \
#     --build-arg VITE_API_URL=https://api.example.com/api/v1 \
#     --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_... \
#     -t scriptorium/client .
#
# Vite statically inlines `import.meta.env.VITE_*` at build time (see
# packages/client/src/env.ts), so the bundle - and therefore this image - is
# environment-specific. A second environment means a second build with
# different args, or moving to runtime config injection.

ARG NODE_VERSION=22.22.0
ARG NGINX_VERSION=1.27

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
# build: `vite build` -> packages/client/dist (index.html + hashed assets).
# ---------------------------------------------------------------------------
FROM deps AS build
ENV NX_DAEMON=false NODE_ENV=production
COPY . .

# Config baked into the bundle. VITE_PROVIDER_REMOTE_URL is optional - the
# consumer just never mounts that remote when it is unset.
ARG VITE_API_URL
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_PROVIDER_REMOTE_URL
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY} \
    VITE_PROVIDER_REMOTE_URL=${VITE_PROVIDER_REMOTE_URL}

RUN pnpm exec nx build client

# ---------------------------------------------------------------------------
# runtime: nginx serving the static tree. The -unprivileged variant listens
# on 8080 and runs as a non-root user out of the box.
# ---------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION}-alpine AS runtime
COPY docker/client.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/client/dist /usr/share/nginx/html

EXPOSE 8080
# GET /healthz is defined in client.nginx.conf - use it for k8s probes.
