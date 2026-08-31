# Local development environment

Spec section resolving [#10 Local dev environment](https://github.com/Cal3574/scriptorium/issues/10).
Part of [#2 Wayfinder map: Scriptorium MVP](https://github.com/Cal3574/scriptorium/issues/2).

## Summary

Local dev is offline-first for everything except Clerk.
`docker compose` carries only Postgres+pgvector and Redis.
Object storage is a real AWS S3 dev bucket (single-developer project, so per-contributor AWS friction does not apply).
The three external AI providers (LlamaParse, OpenAI, Claude) are replaced in dev by config-switched fake adapters, so the full ingest and RAG pipeline runs with zero cost, zero AI keys, and no network latency.
Auth always runs against a real Clerk development instance; there is no auth-bypass branch in the guard.

### What runs where

| Concern | Local dev | Staging / prod |
| --- | --- | --- |
| Postgres + pgvector | `pgvector/pgvector:pg17` container | self-hosted pod in k3s |
| Redis | `redis:7-alpine` container | self-hosted pod in k3s |
| Object storage | real AWS S3 dev bucket | real AWS S3 bucket |
| PDF extraction | `FakePdfExtractor` | LlamaParse (`LlamaParseExtractor`) |
| Embeddings | `FakeEmbeddingClient` | OpenAI (`OpenAiEmbeddingClient`) |
| LLM | `FakeLlmClient` | Claude (`ClaudeLlmClient`) |
| Auth | real Clerk development instance | real Clerk production instance |

## Provider mode

`packages/providers` already defines each external dependency as an interface + DI token + adapter (see [#4 Monorepo package layout](https://github.com/Cal3574/scriptorium/issues/4)).
This spec adds a second adapter per interface and a single switch that selects which adapter the DI container binds at boot.

### The switch

`PROVIDER_MODE` is read by `loadApiConfig()` and `loadWorkerConfig()` in `packages/config`.

- `PROVIDER_MODE=live` (default, and the only value used outside local dev): binds `LlamaParseExtractor`, `OpenAiEmbeddingClient`, `ClaudeLlmClient`. The live-provider keys (`LLAMAPARSE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) become **required** by the Zod schema in this mode.
- `PROVIDER_MODE=fake` (local dev default in `.env`): binds the three fake adapters. The live-provider keys are not required and are ignored if present.

The switch is all-or-nothing on purpose: there is no per-provider override.
Mixing a real LLM with fake embeddings produces incoherent RAG results and is not a case worth supporting.

`server-core` owns the binding. Sketch:

```ts
// packages/server-core/src/providers.module.ts
const providerAdapters = (mode: ProviderMode): Provider[] =>
  mode === 'fake'
    ? [
        { provide: PDF_EXTRACTOR, useClass: FakePdfExtractor },
        { provide: EMBEDDING_CLIENT, useClass: FakeEmbeddingClient },
        { provide: LLM_CLIENT, useClass: FakeLlmClient },
      ]
    : [
        { provide: PDF_EXTRACTOR, useClass: LlamaParseExtractor },
        { provide: EMBEDDING_CLIENT, useClass: OpenAiEmbeddingClient },
        { provide: LLM_CLIENT, useClass: ClaudeLlmClient },
      ];
```

### Fake adapter behaviour

The fakes are not mocks: they return usable, self-consistent data so the pipeline, the SSE stream, and the query screen all work end to end.

**`FakePdfExtractor`** implements the `PdfExtractor` interface (`extract(pdfBytes) -> { markdown, items, metadata }` per the [LlamaParse research](https://github.com/Cal3574/scriptorium/issues/5) shape).

- Ignores the input bytes; returns a committed markdown document with real `#` (book title) and `##` (chapter) headings, 6 to 8 chapters, a few hundred words each.
- Synthesises `items` blocks (`type: 'heading'`, `page_number`, `bbox`, `level`) consistent with the headings so the "Chapter N" derivation from consecutive heading `page_number`s has something to chew on.
- `metadata` reports a plausible printed page count.
- Fixture lives at `packages/providers/src/fake/fixtures/sample-book.md`.

**`FakeEmbeddingClient`** implements `embed(texts: string[]) -> number[][]`, native 1536-d.

- Deterministic: the vector is derived from a hash of the input text, so the same chunk always embeds to the same vector and cosine similarity between chunks is stable across runs.
- Implementation: seed a small PRNG (e.g. `mulberry32`) from a 32-bit hash (`cyrb53` or similar) of the text, generate 1536 values in `[-1, 1]`, L2-normalise.
- Similar strings do **not** produce similar vectors (no semantic content), so RAG relevance in fake mode is effectively random. That is acceptable: fake mode proves the plumbing (pgvector query runs, top-k returns rows, citations render), not retrieval quality.

**`FakeLlmClient`** implements the `LlmClient` interface used for book summary, chapter deep-dives, and query synthesis.

- Returns a templated markdown string that echoes salient input (chapter heading, first sentence, book title) so summaries are visibly distinct per chapter and per book.
- Fixed ~200 ms artificial delay per call so SSE `stage_progress` events are observable in the UI rather than flashing past.
- For query synthesis, emits a short paragraph plus a bullet list of the `book / chapter` citations it was handed, so the Query screen's citation rendering is exercised.

### Testing note

The fakes double as the substrate for CI integration tests (see the map's "Not yet specified" testing-strategy entry, to be resolved in [#7](https://github.com/Cal3574/scriptorium/issues/7)).
This spec only commits to the fakes existing and being config-selected; the test strategy that consumes them is a later ticket.

## docker-compose.yml

Lives at repo root. Only stateful infra; the apps run on the host via Nx for fast reload.

```yaml
name: scriptorium

services:
  postgres:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    environment:
      POSTGRES_USER: scriptorium
      POSTGRES_PASSWORD: scriptorium
      POSTGRES_DB: scriptorium_dev
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U scriptorium -d scriptorium_dev']
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ['redis-server', '--appendonly', 'yes']
    ports:
      - '6379:6379'
    volumes:
      - redisdata:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
  redisdata:
```

Notes:

- No `init.sql`. The `vector` extension is created by the first Drizzle migration, which hand-prepends `CREATE EXTENSION IF NOT EXISTS vector` (locked in [#3 Data model & schema](https://github.com/Cal3574/scriptorium/issues/3)). The container stays a dumb data store.
- The image tracks Postgres 17 with a current pgvector build, which satisfies the HNSW index requirement (pgvector >= 0.5) from [#3](https://github.com/Cal3574/scriptorium/issues/3).
- Named volumes, not bind mounts, so `docker compose down` keeps data and `db:reset` is an explicit `docker compose down -v`.
- AOF on Redis so BullMQ job and checkpoint state survives `docker compose restart`.

## .env.example

Single exhaustive file at repo root, committed. `.env` is gitignored and is what `nx` loads for `serve`.

```dotenv
# ---------------------------------------------------------------------------
# Scriptorium local development environment
# Copy to .env and fill in the sections marked REQUIRED.
# In PROVIDER_MODE=fake (the default), only Clerk and AWS need real values.
# ---------------------------------------------------------------------------

# --- Provider mode ---------------------------------------------------------
# fake  = FakePdfExtractor / FakeEmbeddingClient / FakeLlmClient (offline, free)
# live  = LlamaParse / OpenAI / Claude (requires the *_API_KEY vars below)
PROVIDER_MODE=fake

# --- Postgres (matches docker-compose.yml) --------------------------------
DATABASE_URL=postgresql://scriptorium:scriptorium@localhost:5432/scriptorium_dev

# --- Redis (matches docker-compose.yml) -----------------------------------
REDIS_URL=redis://localhost:6379

# --- Clerk (REQUIRED - real development instance) -------------------------
# Create a free dev instance at https://dashboard.clerk.com, then:
#   - Publishable + Secret keys: API Keys page
#   - CLERK_JWT_KEY: the PEM public key for networkless verification (see #6)
#   - CLERK_AUTHORIZED_PARTIES: the origin the SPA is served from
CLERK_SECRET_KEY=<clerk-dev-secret-key>
CLERK_JWT_KEY="-----BEGIN PUBLIC KEY-----\n<clerk-dev-jwt-public-key>\n-----END PUBLIC KEY-----"
CLERK_AUTHORIZED_PARTIES=http://localhost:4200
CLERK_WEBHOOK_SIGNING_SECRET=<svix-webhook-signing-secret>   # optional; only if running the user.created webhook locally

# --- AWS S3 (REQUIRED - real dev bucket) ---------------------------------
AWS_REGION=eu-west-2
AWS_ACCESS_KEY_ID=<aws-access-key-id>
AWS_SECRET_ACCESS_KEY=<aws-secret-access-key>
S3_BUCKET=scriptorium-dev-yourname
# Optional: presigned PUT URL TTL in seconds
S3_PRESIGN_TTL=900

# --- External AI providers (REQUIRED only when PROVIDER_MODE=live) --------
LLAMAPARSE_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# --- Seed script --------------------------------------------------------
# After first sign-in, copy your Clerk user id (the JWT `sub`, starts `user_`)
# here so the seeded demo book is owned by your account.
SEED_CLERK_USER_ID=

# --- Ports / URLs -------------------------------------------------------
API_PORT=3000
API_URL=http://localhost:3000

# --- Client (Vite - only VITE_-prefixed vars reach the browser) --------
VITE_CLERK_PUBLISHABLE_KEY=<clerk-dev-publishable-key>
VITE_API_URL=http://localhost:3000
```

### Validation

`packages/config` exposes `loadApiConfig()` and `loadWorkerConfig()`, each a Zod schema parsed once at process start; a parse failure logs the missing/invalid keys and exits non-zero (locked in [#4](https://github.com/Cal3574/scriptorium/issues/4)).

- Both schemas require `DATABASE_URL`, `REDIS_URL`, `PROVIDER_MODE`, the Clerk vars, and the AWS vars.
- `LLAMAPARSE_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are conditionally required: `z.string().min(1)` when `PROVIDER_MODE === 'live'`, else `z.string().optional()`. Use a `superRefine` or a discriminated schema keyed on `PROVIDER_MODE`.
- `api` additionally requires `API_PORT`, `API_URL`, `S3_PRESIGN_TTL`.
- `SEED_CLERK_USER_ID` is only read by the seed script, not by the app loaders.

The `client` package must not import `packages/config` (boundary rule: `client -> contracts` only).
It reads `import.meta.env.VITE_*` directly, guarded by a tiny module that throws on load if `VITE_CLERK_PUBLISHABLE_KEY` or `VITE_API_URL` is absent:

```ts
// packages/client/src/env.ts
const required = ['VITE_CLERK_PUBLISHABLE_KEY', 'VITE_API_URL'] as const;
for (const k of required) {
  if (!import.meta.env[k]) throw new Error(`Missing ${k} - see .env.example`);
}
export const env = {
  clerkPublishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
  apiUrl: import.meta.env.VITE_API_URL,
};
```

## S3 dev bucket setup (one time)

The browser does a presigned `PUT` straight to S3, so the bucket needs a CORS rule allowing `PUT` from the dev origin.

1. Create the bucket (private, block all public access, default encryption on):

   ```sh
   aws s3api create-bucket \
     --bucket scriptorium-dev-yourname \
     --region eu-west-2 \
     --create-bucket-configuration LocationConstraint=eu-west-2
   ```

2. Apply the CORS policy:

   ```sh
   aws s3api put-bucket-cors --bucket scriptorium-dev-yourname --cors-configuration '{
     "CORSRules": [
       {
         "AllowedOrigins": ["http://localhost:4200"],
         "AllowedMethods": ["PUT", "GET"],
         "AllowedHeaders": ["*"],
         "ExposeHeaders": ["ETag"],
         "MaxAgeSeconds": 3000
       }
     ]
   }'
   ```

3. Create an IAM user scoped to `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::scriptorium-dev-yourname/*`, and put its access key pair in `.env`.

The SDK v3 client uses the default AWS endpoint (no `endpoint` override, no `forcePathStyle`); region and credentials come from the `AWS_*` env vars.

## Nx targets and scripts

The [monorepo layout](https://github.com/Cal3574/scriptorium/issues/4) puts Drizzle schema, client, and migrations in `packages/database`.
Add these targets to `packages/database/project.json`:

| Target | Runs | Notes |
| --- | --- | --- |
| `database:migrate` | the standalone compiled `migrate.ts` | applies committed `drizzle-kit` migrations; never runs on app boot |
| `database:seed` | `seed.ts` | idempotent full demo book; see below |
| `database:generate` | `drizzle-kit generate` | authoring new migrations (not part of `dev`) |

Root `package.json` scripts:

```json
{
  "scripts": {
    "dev": "./scripts/dev.sh",
    "db:up": "docker compose up -d --wait",
    "db:down": "docker compose down",
    "db:reset": "docker compose down -v && docker compose up -d --wait && pnpm nx run database:migrate && pnpm nx run database:seed"
  }
}
```

### scripts/dev.sh

```sh
#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "No .env found. Copy .env.example to .env and fill in Clerk + AWS values."
  exit 1
fi

echo "==> Starting Postgres + Redis"
docker compose up -d --wait   # --wait blocks until healthchecks pass

echo "==> Running migrations"
pnpm nx run database:migrate

echo "==> Seeding demo book"
pnpm nx run database:seed

echo "==> Starting api + worker + client"
pnpm nx run-many -t serve -p api worker client
```

`docker compose up --wait` (Compose v2.1.1+) already blocks on the healthchecks defined in the compose file, so no hand-rolled poll loop is needed.
If the installed Compose is older, replace with `docker compose up -d` followed by a `pg_isready` / `redis-cli ping` retry loop.

## Seed script

`packages/database/src/seed.ts`, run by `database:seed`.

Behaviour:

1. Reads `SEED_CLERK_USER_ID` from the environment. If unset, it seeds against a placeholder id (`user_seed_placeholder`) and prints a note that the demo book will not be visible until the var is set and the seed re-run.
2. Idempotent: deletes any existing rows tagged with the seed marker (a fixed `books.id` UUID, cascading to chapters/chunks/queries) and the seed user, then re-inserts.
3. Upserts a `users` row: `clerk_user_id = SEED_CLERK_USER_ID`, matching the JIT-upsert shape the guard uses.
4. Pushes the committed fixture PDF (`packages/database/src/seed/fixtures/sample-book.pdf`, a tiny real PDF) through the **actual ingest pipeline** with `PROVIDER_MODE=fake` wired in: extract -> identifyBook -> chunk -> embed -> bookSummary -> chapterSummary -> ready.
   This exercises the real stage code and the real Drizzle writes rather than hand-authoring rows, so the seed cannot drift from the schema.
5. Uploads the fixture PDF to the S3 dev bucket under the book's key (the pipeline and delete both expect the object to exist).

Result on first `pnpm dev` (once `SEED_CLERK_USER_ID` is set): Library shows one book in `ready` state, Book detail shows a fake summary plus 6 to 8 expandable chapter deep-dives, Query returns rows with citations.

## First-run checklist

1. `docker`, `pnpm`, and the `aws` CLI installed; AWS CLI configured or `AWS_*` vars exported.
2. Create the S3 dev bucket and apply CORS (see above). One time.
3. Create a Clerk development instance; collect the publishable key, secret key, and JWT public key.
4. `cp .env.example .env` and fill in the Clerk and AWS sections. Leave `PROVIDER_MODE=fake` and the AI keys blank.
5. `pnpm install`.
6. `pnpm dev`. Postgres + Redis come up, migrations run, the seed runs (against the placeholder user the first time), and api + worker + client start.
7. Open `http://localhost:4200`, sign in with a `+clerk_test` email (OTP `424242`).
8. Copy your Clerk user id (`sub` in the token, visible in the Clerk dashboard) into `SEED_CLERK_USER_ID` in `.env`, then `pnpm nx run database:seed` again. The demo book now belongs to you.
9. Upload any PDF: in fake mode it is ignored and the fixture book content is produced, but the full pipeline, SSE progress, and delete all run for real.

## Going live locally

To exercise the real providers (a paid, slower run - do this before shipping):

1. Set `PROVIDER_MODE=live` in `.env`.
2. Fill `LLAMAPARSE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
3. Restart api + worker. The config loaders now require those three keys and will refuse to start without them.

Everything else (Postgres, Redis, S3, Clerk) is unchanged between fake and live mode.
