# Testing strategy

Resolution of the closing grilling ticket [Grill the Scriptorium MVP map to a close](https://github.com/Cal3574/scriptorium/issues/15) (part of [Wayfinder map: Scriptorium MVP](https://github.com/Cal3574/scriptorium/issues/2)).

This locks how the MVP is tested: the seams, the unit / integration boundary, how the pgvector and BullMQ paths run in CI, fixture conventions, and the CI gate.
It consumes the fake provider adapters from [Local dev environment](https://github.com/Cal3574/scriptorium/issues/10) as its substrate and the per-spec testing notes in [Chapter detection & book-summary strategy](https://github.com/Cal3574/scriptorium/issues/7) and [RAG query spec](https://github.com/Cal3574/scriptorium/issues/11).

## 1. What makes a good test here

A test asserts **externally observable behaviour**, never an implementation detail.

- Good: "`POST /books/:id/retry` on a `ready` book returns `409` with `code: book_not_failed`".
- Good: "after the ingest job runs against a fixture PDF, the book row is `ready` and has 6 to 8 chapters each with a non-null summary".
- Bad: "the `ChunkStage` calls `detectChapters` before `sliceChunks`".
- Bad: asserting a private method was invoked, or snapshotting an internal object shape that no consumer sees.

The consequence: refactoring the internals of a stage, a service, or a mapper must not change a single test, as long as the HTTP contract and the database outcome are unchanged.
Tests are written against the contracts in `@scriptorium/contracts`, the HTTP surface in the [API surface](https://github.com/Cal3574/scriptorium/issues/9) spec, and the database end state.

## 2. The three seams

Testing happens at exactly three seams, in priority order.

### Seam 1 (primary): the HTTP API

`supertest` against the real Nest `api` application, booted with:

- `PROVIDER_MODE=fake`, so `FakePdfExtractor` / `FakeEmbeddingClient` / `FakeLlmClient` are bound (no AI keys, no network, no cost).
- A **real Postgres + pgvector** database (section 4).
- Locally-minted Clerk JWTs for auth (section 6).

One seam covers auth, the ownership `404` rule, Zod validation (`422` / `400`), every endpoint's success and documented error codes, the RFC 9457 problem body, the upload to create handshake, the streamed `POST /queries` path, and the real pgvector query behind it.
This is the highest seam and where most of the coverage value sits.

Every endpoint in the API-surface reference table has at least one Seam 1 test for its success path and one per documented error `code`.

### Seam 2: the ingest pipeline

The BullMQ job processor is driven **directly** (`await process(job)`), not through HTTP, against a real Postgres + Redis and the fake providers.

Asserts:

- the database end state after a full run (book `ready`, chapters present, every `chapters.summary` and `books.summary` set),
- **derive-from-data resumption**: pre-seed a partially-complete book (for example chunks present but unembedded), run the job, assert only the unfinished work was redone,
- **failure and retry**: force a fake provider to throw, assert the book lands `failed` with the right `failed_stage`, then assert a re-run completes it,
- the **SSE event stream** for a run (section 5),
- **abort**: set `status = 'deleting'` mid-run, assert the job returns cleanly at the next stage boundary.

Needed because Seam 1 cannot trigger real, deterministic job execution.

### Seam 3: pure unit tests

Direct function calls, no I/O, for the highest-risk pure logic:

- **chapter detection** (the algorithm from [#7](https://github.com/Cal3574/scriptorium/issues/7)): fixture LlamaParse payload plus `pdfjs` outline in, ordered chapter list out. Case table covers the known hard cases (missing chapter 1 via gap synthesis, TOC-page exclusion, author-name headings ignored, fewer than 2 markers falling back to the outline, zero structure falling back to one chapter).
- **RAG chunk selection** (§2.4 of [#11](https://github.com/Cal3574/scriptorium/issues/11)): a candidate array with similarity scores in, the final set of 0 to 12 out. Case table covers the per-book cap with backfill, the `0.25` absolute floor, and the low-confidence fallback with the `lowConfidence` flag.
- **the citation post-parser** (§3.3 of [#11](https://github.com/Cal3574/scriptorium/issues/11)): answer markdown in, the set of cited `[n]` markers out, including out-of-range markers dropped.
- **DTO mappers** (`toBookDto`, `toChapterDto`, ...): a Drizzle row shape in, the DTO out, asserting `chunk_text` / `embedding` and un-DTO'd columns are stripped.
- **config loaders** (`loadApiConfig` / `loadWorkerConfig`): env object in, parsed config out or a thrown error, asserting the `PROVIDER_MODE=live` conditional-required keys.

### Not seams

- **No browser / E2E seam.** No Playwright, no Cypress.
- **No client test seam.** The React screens, the `EventSource` / `fetch`-reader stream consumers, reconnection and keep-alive behaviour are validated by hand against the running app, not in the automated suite.
- **No per-stage worker mocking.** The pipeline is tested as one unit at Seam 2, not stage by stage with the other stages mocked.

## 3. Test targets and layout

| Nx target | Scope | Docker needed | Runs in |
| --- | --- | --- | --- |
| `test` | Seam 3 pure unit tests, per project | no | `nx affected -t test` on every PR, and pre-commit |
| `test-integration` | Seams 1 and 2 | yes (Postgres + Redis) | CI only, and locally on demand |

`test-integration` is a separate target so the fast unit feedback loop never depends on containers.
Framework stays **Jest + SWC**, already configured for `api` and `worker` via Nx.
No Vitest: there is no client seam that would need it.

Fixtures live in `__fixtures__/` directories next to the code under test.

The four Nx scaffold specs (`app.controller.spec.ts` / `app.service.spec.ts` in `api` and `worker`) are **deleted**: they assert a placeholder string and are replaced by real tests as code lands.

## 4. Database and Redis in tests

Same image everywhere: `pgvector/pgvector:pg17` and `redis:7-alpine`.

- **Locally:** `test-integration` points at the dev `docker compose` Postgres, using a separate `scriptorium_test` database on it, so tests never touch dev data. Redis is the same dev container, on a dedicated logical DB index.
- **In CI:** GitHub Actions `services:` containers using those images.

**Schema:** the real committed Drizzle migrations are applied once at the start of the job via the same `database:migrate` the app uses.
Never `drizzle-kit push`.
This exercises the real migration path, including the hand-edited `CREATE EXTENSION IF NOT EXISTS vector` in the first migration and the HNSW index creation.

**Isolation between tests:** a `beforeEach` runs `TRUNCATE <all tables> RESTART IDENTITY CASCADE` and flushes the Redis test DB.
Not transaction-rollback-per-test: the worker pipeline and BullMQ open their own connections and would not see a wrapping transaction's writes.
Truncate is simple and fast at this data scale (tens of rows per test).

## 5. Testing the streaming paths

Both streaming endpoints are asserted **server-side only**.

### `POST /queries` (SSE over a POST body)

At Seam 1: buffer the full response body, split on the SSE record separator, JSON-parse each `data:` line, then assert:

- the event order is `query_started` then `citations` then one or more `text_delta` then `done`,
- `query_started` carries the `queries` row id,
- `citations` carries every selected chunk in `[n]` order with the full `Citation` shape,
- the concatenation of the `text_delta` payloads equals the `done` answer,
- the `queries` row is updated exactly once, at `done`, with `answer` and `citations`,
- on a forced fake-LLM error mid-stream, an `error` event is emitted and the row keeps `answer = null`.

`FakeLlmClient` emits a deterministic short stream, so these assertions are stable.

### `GET /books/:id/events` (real SSE)

Driven from Seam 2: subscribe to the endpoint, run the ingest job, assert the ordered event list:

- every fresh connection leads with a full `snapshot` built from the book's columns,
- `seq` is monotonic per book,
- stage events fire in pipeline order,
- a terminal event (`book_completed` / `book_failed` / `book_deleted`) is the last event and the stream then closes.

## 6. Auth in tests

The `ClerkAuthGuard` has **no bypass branch** and runs on every request, including in tests.
The guard verifies tokens with `@clerk/backend` `verifyToken`, which is networkless RSA verification against `CLERK_JWT_KEY`.

Test setup:

1. Generate an RSA keypair once per test run.
2. Pass the public key to the app as `CLERK_JWT_KEY`.
3. Sign short-lived JWTs with the private key carrying the claims the guard reads (`sub`, `email`, `azp` matching `authorizedParties`).

`verifyToken` cannot distinguish a test-signed token from a real Clerk one, so this needs **zero changes to the guard**.

A helper `authHeaderFor({ clerkUserId, email })` returns `{ Authorization: 'Bearer <signed>' }`.
Ownership tests mint two different `sub` values and assert the cross-user `404`.
The SSE `?token=` path uses the same minted tokens.

**Not covered by the automated suite** (validated once by hand against the real Clerk dev instance, as [Clerk integration](https://github.com/Cal3574/scriptorium/issues/6) already assumed):

- `verifyToken` against Clerk's live JWKS,
- the JIT upsert against a real Clerk user,
- the `user.created` svix webhook.

## 7. Fixtures

### Chapter detection ([#7](https://github.com/Cal3574/scriptorium/issues/7))

Two to three real captured LlamaParse payloads (per-page markdown, `items` heading blocks, `metadata`) committed as JSON under the chunk stage's `__fixtures__/`.
At least one is the full `The Pragmatic Programmer` capture from the prototype, which carries the known hard cases.
Each fixture has a sibling `expected.json`: the chapter list the detector must produce.
These are regenerated only by hand, via a documented script in the prototype directory, if the LlamaParse response shape changes.
They are not a runtime or CI dependency.

### The `FakePdfExtractor` sample book

`packages/providers/src/fake/fixtures/sample-book.md` (from [#10](https://github.com/Cal3574/scriptorium/issues/10)) is a **separate, simpler** fixture.
It drives the happy-path pipeline and the seed script, not the detector's edge cases.

### RAG ([#11](https://github.com/Cal3574/scriptorium/issues/11))

- Selection unit tests: hand-written candidate arrays in the test file. No external capture.
- Retrieval integration test: about 15 to 20 fixture chunk texts, embedded via `FakeEmbeddingClient` at test setup (deterministic vectors), then inserted. Assertions are on result ordering and the `user_id` / `bookId` filters. No pre-computed vectors are committed.

## 8. CI gate

GitHub Actions, on every PR, in order:

1. `lint`
2. `typecheck`
3. `nx affected -t test` (Seam 3, no Docker)
4. `test-integration` (Seams 1 and 2, with the Postgres and Redis service containers)
5. `build`

Any failure fails the PR.

**No numeric coverage threshold.**
Coverage percentages are gamed against the number.
The bar is behavioural and enforced in review:

- every endpoint in the API-surface table has a Seam 1 test for its success path and each documented error `code`,
- every ingest stage's success, failure, and resume behaviour is hit by a Seam 2 test,
- the three pure algorithms (chapter detection, RAG selection, citation parser) have explicit case tables.

## 9. Prior art

None in-repo.
This spec establishes the patterns.
The stream-buffering approach (buffer, split on the record separator, JSON-parse `data:`) is the standard way to assert an SSE body from a non-browser client.
