# Ingest job spec

Resolution of wayfinder ticket [Ingest job spec](https://github.com/Cal3574/scriptorium/issues/8) (part of [Wayfinder map: Scriptorium MVP](https://github.com/Cal3574/scriptorium/issues/2)).

This locks the ingest pipeline for the MVP: the stage list and order, the checkpointed-resume model, per-stage status and SSE mapping, embedding mechanics, summary-stage orchestration, the BullMQ failure and retry policy, the SSE event contract published over Redis pub/sub, the reconnect behaviour, and the abort path when a book is deleted mid-job.

It builds directly on [Data model & schema](https://github.com/Cal3574/scriptorium/issues/3), which already fixed the `book_status` enum, the derive-from-data resumption principle, the retry edge, and the delete flow.
This document is the pipeline-level detail that schema doc deferred to `#8`.

Open dependency: the *content* of the two summary stages (prompt inputs, `books.summary` shape, whether a chapter deep-dive reads whole-chapter prose or its chunks) belongs to [Chapter detection & book-summary strategy](https://github.com/Cal3574/scriptorium/issues/7).
This spec fixes only the orchestration of those stages and marks the seam.

## 1. Job shape

One BullMQ job per book.
There is no flow, no job-per-stage chain, and no parent/child graph.

| Property | Value |
|---|---|
| Queue | `ingest` (Redis + BullMQ, per the settled stack) |
| Job name | `ingest` |
| `jobId` | the book's `uuid` (so a duplicate enqueue for the same book is a no-op) |
| `data` | `{ bookId: string }` and nothing else |
| Worker | the `@scriptorium/worker` NestJS pod, a single replica |
| Worker concurrency | `1` (one book's pipeline at a time; see the embedding and rate-limit reasoning in sections 5 and 6) |

The processor is a fixed, hardcoded list of six stages walked from the top on every job start.
Execution is a **checkpointed sequential pipeline**, not a state machine.
Nothing branches on stored state to decide what runs next; the database is the position.

```ts
const STAGES: Stage[] = [
  extractStage,
  identifyBookStage,
  chunkStage,
  embedStage,
  bookSummaryStage,
  chapterSummaryStage,
];

async function process(job: Job<IngestJobData>) {
  const { bookId } = job.data;

  for (const stage of STAGES) {
    if (await abortRequested(bookId)) return;        // clean return, see section 9
    if (await stage.isComplete(bookId, deps)) continue;

    await enterStatus(bookId, stage.enterStatus);    // DB write + SSE publish
    await stage.run(bookId, deps);
  }

  if (await abortRequested(bookId)) return;
  await setStatus(bookId, 'ready');
  await publish(bookId, { type: 'book_completed', status: 'ready' });
}
```

Each `Stage` is:

```ts
interface Stage {
  name: string;                    // 'extract', 'identifyBook', ...
  enterStatus: BookStatus;         // the display status written on entry
  isComplete(bookId: string, deps: Deps): Promise<boolean>;
  run(bookId: string, deps: Deps): Promise<void>;
}
```

## 2. Stage list, order, and status mapping

Six stages, five distinct `book_status` values.
`identifyBook` runs under `extracting`; both summary stages run under `summarizing`.

| # | Stage | `book_status` on entry | Work | `isComplete` when |
|---|---|---|---|---|
| 1 | `extract` | `extracting` | LlamaParse upload + poll; store full markdown to S3 (`extracted_markdown_key`); S3 `HEAD` for `file_size_bytes`; `page_count` from LlamaParse metadata | `books.extracted_markdown_key is not null` |
| 2 | `identifyBook` | `extracting` (no new status) | one cheap Claude call over the first ~2 pages -> `{ title, author }`; skipped entirely if the client supplied a `title` on `POST /books` | `books.title is not null` OR the client sent an override |
| 3 | `chunk` | `chunking` | detect chapters (algorithm owned by `#7`); slice sub-chapter chunks; insert `chapters` rows and `chunks` rows with `embedding = null` | `exists (select 1 from chapters where book_id = $1)` |
| 4 | `embed` | `embedding` | batch-embed every chunk with `embedding is null` via OpenAI `text-embedding-3-small` | chunk count > 0 AND no `chunks` row for the book with `embedding is null` |
| 5 | `bookSummary` | `summarizing` | one Claude call -> `books.summary`; sets `summary_generated_at` | `books.summary is not null` |
| 6 | `chapterSummary` | `summarizing` | per-chapter Claude deep-dive loop -> `chapters.summary` | `not exists (select 1 from chapters where book_id = $1 and summary is null)` |
| - | finalize | `ready` | none | n/a |

Notes:

- `identifyBook` failure is **non-fatal**.
  If the Claude call still errors after its in-stage retries, log it, leave `title` and `author` null, and continue the pipeline.
  The Library and Book-detail screens already fall back to `original_filename`.
- Stage 5 runs before stage 6 in the list.
  If `#7` decides the whole-book summary should be synthesised *from* the per-chapter summaries, swap the order (stage 6 before stage 5); nothing else in this spec changes.
- Chunking is the only CPU-bound stage.
  It must `await setImmediate()` between chapters so the BullMQ lock-renewal timer is never starved (see section 8).

### `book_status` transitions

Unchanged from the schema doc; reproduced here as the display-state machine the SSE contract projects.

```
pending -> extracting -> chunking -> embedding -> summarizing -> ready
(any non-terminal state)          -> failed
(any state)                       -> deleting        [row is then removed]
failed                            -> pending         [user-driven retry: re-enqueue]
ready                             -> deleting
```

`status` never moves backward except the explicit `failed -> pending` retry.
It is written by each stage on entry and read only by the SSE layer and the UI.
A stale `status` after a crash is harmless: the next job start recomputes reality from the six `isComplete` checks and bumps `status` forward as it goes.

## 3. Resumption: derive-from-data

On every job start, first attempt or any retry, the worker walks `STAGES` from the top and skips any stage whose `isComplete` returns true.
No stage trusts a "current step" pointer.

The nullability of `chunks.embedding` and `chapters.summary` is what makes a *partially done* stage resumable mid-batch:

- `embed` selects `where embedding is null order by chunk_index` and processes in batches, so a worker that dies after 300 of 800 embeddings resumes on the remaining 500.
- `chapterSummary` selects `where summary is null order by chapter_index`, so it resumes on the chapters still missing a summary.

A book that failed at `embed` therefore runs `failed -> pending -> embedding -> summarizing -> ready` on retry, redoing only unfinished work.
There is no "resume at stage X" value stored anywhere.

## 4. BullMQ failure and retry policy

Two layers of retry.

**Layer 1, in-stage:** each stage handles provider rate limits and transient provider errors itself, retrying the *failing unit of work* (an embed batch, a single Claude call) without restarting the stage.
Parameters are per-stage (sections 5 and 7) but the shape is common: up to 5 attempts, exponential backoff, honour a `Retry-After` / `retry-after` header when present, jitter added.

**Layer 2, job-level:** if a stage exhausts its in-stage retries and throws, BullMQ retries the whole job.
The retry re-walks `STAGES` and skips everything already complete.

Job options:

| Option | Value | Rationale |
|---|---|---|
| `attempts` | `4` | one initial run plus three retries; absorbs a whole-stage transient failure |
| `backoff` | `{ type: 'exponential', delay: 10_000 }` | 10s, 20s, 40s between job-level retries |
| `removeOnComplete` | `{ age: 86_400, count: 100 }` | one day of history for debugging, capped at 100 |
| `removeOnFail` | `false` | failed jobs are kept indefinitely as the audit trail |
| `lockDuration` | `60_000` | see section 8 |
| `maxStalledCount` | `1` | see section 8 |

### Terminal vs retryable errors

A stage that hits a **terminal** error calls a shared helper that:

1. sets `books.status = 'failed'`, `books.failed_stage = <stage name>`, `books.failure_reason = <user-facing string>`,
2. publishes a `book_failed` SSE event,
3. throws `UnrecoverableError` (BullMQ built-in) so the job stops retrying immediately rather than burning the remaining `attempts`.

A stage that hits a **retryable** error just throws a normal `Error`; BullMQ applies the backoff and retries.

**Terminal:**

- LlamaParse `PDF_IS_BROKEN`, `PDF_IS_PROTECTED`, any 4xx except 429.
- File exceeds the LlamaParse 512 MB cap.
- Claude or OpenAI `400` (malformed request), `401` / `403` (auth or key problem); retrying will not help.
- Chapter detection yields zero chapters and the regex fallback also yields zero, and `#7` has not defined a single-synthetic-chapter fallback.
- Our own bugs surfacing as `TypeError` or data-validation errors.

**Retryable:**

- `429` from any provider, after in-stage backoff is exhausted.
- `5xx` from any provider.
- LlamaParse `TIMEOUT`, a job stuck in progress, `partial_success` (see soft rule below).
- Network errors: socket timeouts, `ECONNRESET`, DNS failures.
- Redis or Postgres transient connection errors.

**Soft rule, LlamaParse `partial_success`:** retry once at the same tier.
If still partial, accept the partial markdown and continue the pipeline.
A partially parsed book is a better outcome than a hard failure.

### What a permanently failed book looks like

- `books.status = 'failed'`, `books.failed_stage` set (for example `'embedding'`), `books.failure_reason` set to a user-facing message.
- The BullMQ job sits in the `failed` set with its stack trace.
- There is no separate dead-letter queue.
  The BullMQ `failed` set plus the `books` row is the dead-letter record.
- Recovery is user-driven only: the API sets `status = 'pending'`, removes the old failed job (`job.remove()`), and re-adds the job with the same `jobId`.

## 5. Embedding stage mechanics

Facts, OpenAI embeddings API, `text-embedding-3-small`:

- one request accepts an array of inputs; hard caps are 2048 inputs per request and 300,000 tokens per request; per-input cap 8191 tokens.
- Tier-1 rate limits are approximately 3,000 RPM and 1,000,000 TPM, higher on paid tiers.
- The response returns embeddings for the whole batch in input order, or errors the whole request.
  There is no partial `200`.

Our chunks are ~600 tokens; a 300-page book is roughly 600 to 1,000 chunks.

| Parameter | Value | Rationale |
|---|---|---|
| Batch size | 128 chunks per request | ~77k tokens per request, well under both caps; a failed batch loses at most 128 chunks of work; ~5 to 8 progress updates for a typical book |
| Ordering | `where embedding is null order by chunk_index`, sliced into batches of 128 | deterministic, resumable |
| Concurrency | 2 batches in flight | halves wall-clock on large books; leaves TPM headroom |
| Write-back | after each successful batch, one transaction that fills `embedding` for that batch's chunk ids (bulk `update ... from (values ...)` or per-row `update`) | the batch becomes atomically "done"; a crash resumes from the next null |
| Input | `chunk_text` verbatim, no preprocessing | |
| Dimensions | native 1536, no `dimensions` param | matches `vector(1536)` and the HNSW index |

**In-stage retry:** on `429` or `5xx` for a batch, retry that batch up to 5 times with exponential backoff honouring `Retry-After` (fallback 2s, 4s, 8s, 16s, 32s, plus jitter).
Only if a batch still fails after 5 in-stage attempts does the stage throw and hand off to the job-level retry.

**Partial failure within a batch:** not possible (all-or-nothing response), so no per-item reconciliation.

## 6. Summary-stage orchestration

The prompt inputs and the summary output shape are owned by [Chapter detection & book-summary strategy](https://github.com/Cal3574/scriptorium/issues/7).
This section fixes only orchestration.

### `bookSummary` (stage 5)

- A single Claude Sonnet 5 call.
- `isComplete` = `books.summary is not null`.
- On success, set `books.summary` and `books.summary_generated_at` in one write.
- In-stage retry: 5 attempts, exponential backoff honouring `retry-after`.
- Terminal / retryable classification per section 4.

### `chapterSummary` (stage 6)

- Loop over `select ... from chapters where book_id = $1 and summary is null order by chapter_index`.
- Concurrency: 3 chapters in flight.
  A 12-chapter book completes in about 4 waves.
- Write-back per chapter: set `chapters.summary` immediately on each chapter's completion, so a crash resumes from the remaining nulls.
- In-stage retry per chapter call: 5 attempts, exponential backoff honouring `retry-after`.
- If one chapter still fails after its in-stage retries and the job-level retries, the whole book goes `failed` with `failed_stage = 'chapterSummary'`.
  A book-detail page with a blank chapter is a worse experience than an explicit retry.

## 7. SSE event contract

### Transport

```
worker  --publish-->  Redis pub/sub channel  book:events:{bookId}
                                   |
API  GET /books/:id/events  --subscribe-->  bridge  --SSE-->  browser EventSource
```

- One Redis channel per book: `book:events:{bookId}`.
  The API `SUBSCRIBE`s on connect and `UNSUBSCRIBE`s on disconnect, so each SSE connection carries only its own book's traffic.
- Redis pub/sub is fire-and-forget.
  If the worker publishes while nobody is subscribed, the event is lost.
  This is acceptable: the `books` / `chapters` status columns are the source of truth, every reconnect gets a fresh `snapshot`, and the client also does a plain `GET /books/:id` refetch on any terminal event.
  The SSE stream is a latency optimisation, not a delivery guarantee.

### Sequence numbers

- `seq` is a monotonic integer per book from a Redis `INCR book:events:seq:{bookId}`, called by the worker immediately before each publish.
- The `snapshot` frame reads live DB state and then reads the current `seq` value.
- The client stores the highest `seq` it has applied and drops any event with `seq <=` that value.
  This resolves the race where a `snapshot` built from fresh DB state is followed by an in-flight delta that is actually older.

### Event catalogue

All event payloads are JSON in the SSE `data:` field.
The SSE `event:` field carries the type.
Every payload carries `bookId` and `seq`.
Zod schemas for all of these live in `@scriptorium/contracts` and are the single source of truth for the shape.

```
event: snapshot            // first frame on every connect and every reconnect
data: {
  bookId, seq,
  status,                              // book_status enum
  stage: "embedding" | null,           // current pipeline stage; null when pending / ready / failed
  progress: { done: 320, total: 800, unit: "chunks" } | null,
  chaptersTotal: 12,
  chaptersSummarized: 4,
  title, author,                       // may be null early in the pipeline
  failedStage, failureReason           // null unless status is failed
}

event: stage_entered
data: { bookId, seq, stage: "chunking", status: "chunking" }

event: stage_progress                  // emitted only for the two long stages
data: { bookId, seq, stage: "embedding", done: 448, total: 800, unit: "chunks" }
//     unit is "chunks" during embed, "chapters" during chapterSummary

event: book_identified                 // title/author backfilled; lets Library swap the card mid-pipeline
data: { bookId, seq, title, author }

event: book_completed
data: { bookId, seq, status: "ready" }

event: book_failed
data: { bookId, seq, failedStage, failureReason }

event: book_deleted                    // see section 9
data: { bookId, seq }
```

Decisions baked into the catalogue:

- `stage_progress` is emitted only for `embed` (per batch) and `chapterSummary` (per completed chapter).
  `extract`, `identifyBook`, `chunk`, and `bookSummary` are single opaque steps and emit only `stage_entered`.
- There is no per-chapter `chapter_summarized` event.
  `stage_progress` with `done` / `total` covers progress, and the client refetches chapter content on `book_completed`.
- `book_identified` is its own event so the Library screen can replace the filename with the real title without waiting for the whole pipeline.

### Connection lifecycle

- On connect and on every reconnect, the API's first write is a `snapshot` event built from the DB columns.
- Granular deltas follow, forwarded from the Redis subscription.
- The API sends a `: keep-alive` SSE comment every 15 seconds so Traefik and any intermediate proxy does not kill an idle connection during a slow LlamaParse poll.
- The API closes the stream (`res.end()`) immediately after forwarding `book_completed`, `book_failed`, or `book_deleted`.
- The client's `EventSource` sees the close; for a terminal book status it does not reconnect.

### Auth

- `EventSource` cannot set request headers, so the Clerk token is passed as a `?token=` query parameter.
- The same Nest guard verifies it with networkless `verifyToken` at connect time.
- The token is verified **once at connect** and not re-checked mid-stream.
  The maximum stream lifetime is one ingest run, on the order of minutes, and the stream closes on any terminal event.

## 8. Long-running stages vs BullMQ stall detection

BullMQ marks a job "stalled" if the processor does not renew its lock within `lockDuration`.
Our stages run for minutes (LlamaParse poll, embed waves, chapter-summary waves).

Approach: rely on BullMQ's automatic lock renewal.

- `lockDuration: 60_000`, `maxStalledCount: 1`.
- The renewal timer fires as long as the event loop is not blocked.
  Every stage `await`s network I/O almost continuously, so renewal is never starved, with one exception.
- The `chunk` stage is CPU-bound (tokenising and slicing).
  It must `await setImmediate()` between chapters so the renewal timer gets the loop.
- With worker concurrency `1` and a single worker replica, stall-reclaim is effectively just crash recovery, which derive-from-data already handles on restart.

Rejected alternatives: raising `lockDuration` to 5 minutes (a genuinely dead worker goes unnoticed for 5 minutes); breaking the LlamaParse poll into BullMQ delayed-job re-enqueues (more moving parts for no real gain on a single-worker setup).

### LlamaParse polling

- In-processor poll loop: `GET` the parse job status every 10 seconds.
- Overall cap 35 minutes (the LlamaParse stated ceiling of 30 minutes plus 5 minutes per page), then throw a retryable `TIMEOUT`.
- No webhook.
  A webhook would need a public API ingress route and HMAC verification for marginal benefit on a single-worker setup.

## 9. Abort path: book deleted mid-ingest

Follows the delete flow from the schema doc, with the pipeline-side mechanics fixed here.

1. `DELETE /books/:id` sets `books.status = 'deleting'` and enqueues a **delete job** on the same `ingest` queue with `name: 'delete'`.
   Worker concurrency `1` naturally serialises the delete job against the ingest job.
2. The ingest processor checks for abort **at each stage boundary** (the `abortRequested(bookId)` call at the top of the loop): it re-reads `books.status`, and if the value is `deleting` or the row is gone, the processor `return`s cleanly.
   A clean return, not a throw, so BullMQ marks the job completed rather than failed.
3. A stage already in flight is **not** interrupted.
   A 4-minute LlamaParse poll or an embed wave runs to completion, and the next boundary check catches the abort.
   Stages are minutes at most and the delete job waits.
4. The delete job:
   1. if the ingest job is `waiting` or `delayed`, removes it;
   2. if the ingest job is `active`, polls until it is no longer active (it will hit its next boundary and return), with a 10-minute timeout after which the delete proceeds regardless;
   3. deletes both S3 objects (`s3_key` and `extracted_markdown_key`);
   4. deletes the `books` row (Postgres cascades `chapters` and `chunks`, nulls `queries.book_id`);
   5. is idempotent: a second run finds no row and no-ops.
5. SSE: the worker publishes nothing special on abort.
   The API polls book existence on each 15-second heartbeat; on a `404` it sends `event: book_deleted` and closes the stream.

## 10. Enqueue trigger (reference only, owned by #9)

- `POST /books` creates the `books` row with `status: 'pending'` and enqueues the ingest job in the same request handler.
- The client is expected to have completed the presigned S3 `PUT` before calling `POST /books`.
- If the S3 object is not yet present, the `extract` stage fails **retryably** (with a short internal wait first), so a small client-side ordering slip self-heals via the job-level retry.
- The exact request and response contract is owned by [API surface](https://github.com/Cal3574/scriptorium/issues/9).

## 11. Contracts to add to `@scriptorium/contracts`

Per the monorepo layout decision, these cross-boundary types live in `contracts` as Zod schemas:

- `IngestJobData` = `{ bookId: string }`.
- The `ingest` queue name and the `delete` job name as constants.
- The seven SSE event schemas from section 7 (`snapshot`, `stage_entered`, `stage_progress`, `book_identified`, `book_completed`, `book_failed`, `book_deleted`) and a discriminated-union `IngestEvent` over them.
- The `PipelineStage` string-literal union (`'extract' | 'identifyBook' | 'chunk' | 'embed' | 'bookSummary' | 'chapterSummary'`).

## Open items handed onward

| Item | Owner |
|---|---|
| Prompt inputs and output shape for `bookSummary` and `chapterSummary`; whether the book summary is synthesised from chapter summaries (which would swap stage 5 and 6) | [#7](https://github.com/Cal3574/scriptorium/issues/7) |
| Chapter-detection algorithm and the zero-chapter fallback that decides whether "0 chapters" is terminal | [#7](https://github.com/Cal3574/scriptorium/issues/7) |
| `POST /books` and `DELETE /books/:id` request/response contracts; the `GET /books/:id/events` endpoint definition | [#9](https://github.com/Cal3574/scriptorium/issues/9) |
| Error surfacing and retry UX in the client when a book is `failed` | map "Not yet specified" |
| Testing strategy for the pipeline (stage unit boundaries, faking the providers, the vector path) | map "Not yet specified" |
