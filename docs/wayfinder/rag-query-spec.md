# RAG query spec

Resolution of wayfinder ticket [RAG query spec](https://github.com/Cal3574/scriptorium/issues/11) (part of [Wayfinder map: Scriptorium MVP](https://github.com/Cal3574/scriptorium/issues/2)).

This owns the retrieval and synthesis **internals** behind `POST /api/v1/queries`.
The HTTP contract of that endpoint - request shape, the SSE event names, auth, status codes - is locked by [API surface](https://github.com/Cal3574/scriptorium/issues/9) and is not re-decided here.
The `chunks` / `queries` table shape, the HNSW cosine index, and `ON DELETE SET NULL` on `queries.book_id` are locked by [Data model & schema](https://github.com/Cal3574/scriptorium/issues/3).

Validated by a throwaway prototype (`packages/worker/prototypes/rag-query/` on branch `wayfinder/rag-query-spec`) against 478 real chunks from 4 thematically-overlapping public-domain books, real `text-embedding-3-small` embeddings, and real `claude-sonnet-5` synthesis.

## 1. Where this logic lives

The retrieval + synthesis pipeline is a service in `packages/api` (not the worker).
It depends on `EmbeddingClient` and `LlmClient` from `@scriptorium/providers` and the Drizzle client from `@scriptorium/database`, all injected via `server-core` (per [Monorepo package layout](https://github.com/Cal3574/scriptorium/issues/4)).
It is a request-scoped, streaming operation - there is no BullMQ job and no worker involvement.
The `queries` row is the only persistence.

## 2. Retrieval

### 2.1 Distance metric and operator

Cosine, via pgvector's `<=>` operator against the `chunks_embedding_hnsw` index.
`text-embedding-3-small` vectors are L2-normalised, so cosine distance, `1 - dot`, and `<=>` all agree; no metric choice is left open.
Similarity is reported to the rest of the pipeline as `1 - (embedding <=> $q)`.

### 2.2 The candidate query

One indexed single-table query, no joins - `chunks` carries denormalised `book_id` and `user_id` for exactly this.

```sql
SET LOCAL hnsw.ef_search = 100;

SELECT id, book_id, book_title, chapter_id, chapter_title, chapter_index,
       chunk_index, chunk_text,
       embedding <=> $1 AS distance
FROM chunks
WHERE user_id = $2
  AND embedding IS NOT NULL
  AND ($3::uuid IS NULL OR book_id = $3)     -- optional single-book filter
ORDER BY embedding <=> $1
LIMIT 50;
```

- `$1` = the question embedding (see 2.3).
- `$2` = `req.user.id` - the local `users.id`, always applied. A user only ever searches their own library.
- `$3` = the optional `bookId` from the request, already ownership-checked by the endpoint (a foreign or missing `bookId` is a `404` before retrieval runs - [API surface](https://github.com/Cal3574/scriptorium/issues/9)).
- `LIMIT 50` is the **candidate pool** - deliberately ~4x the final `k` so the selection step (2.4) has room to re-rank and cap without a second database hop.
- `book_title` / `chapter_title` are denormalised onto `chunks` for the citation payload.
  If the data model keeps them only on `books` / `chapters`, this query joins those two tables on their PKs (cheap - 50 rows); the prototype assumed them denormalised and this is the one open dependency on [Data model & schema](https://github.com/Cal3574/scriptorium/issues/3) - see 2.7.

### 2.3 Embedding the question

`EmbeddingClient.embed([question])` - the same `text-embedding-3-small`, 1536-d, model used at ingest.
The raw `question` string is embedded as-is: no query expansion, no HyDE, no rewriting.
This is a synchronous upstream call; a failure here surfaces as `502 upstream_failure` on the endpoint (it happens before the stream opens).
The question is **not** persisted as an embedding - it is used once and discarded.

### 2.4 Selection: pool (50) -> final set (<=12)

Applied in-process to the 50 candidate rows, in this order:

1. **Per-book cap with backfill.** Walk the pool in similarity order; take at most **6** chunks from any one book into a "primary" list and the rest into a "leftover" list; concatenate `primary + leftover`.
   This prevents one book monopolising a comparative question without ever starving a single-book question (the leftovers backfill).
2. **Absolute similarity floor.** Keep only chunks with `similarity >= 0.25`, then take the first **12**.
3. **Low-confidence fallback.** If fewer than **3** chunks clear the floor, take the top **4** of the capped pool regardless of score and set `lowConfidence = true`.
   This flag is passed to synthesis (3.2) and biases the model toward "not enough context".

Final `k` is therefore **0-12**, typically 12 for a well-covered question and 4 (flagged) for a question the library does not address.

**Rejected alternatives** (all tested in the prototype):

- **MMR / diversity re-ranking** - rejected. At this corpus size the genuinely relevant material for most questions sits in one book; forcing diversity pulled in demonstrably weaker chunks. Not worth the complexity or the per-candidate embedding math.
- **Per-*chapter* cap** - rejected. Starves results when chapter segmentation is coarse (a book with 4 detected "chapters" collapsed to 3-5 chunks). The per-book cap achieves the "avoid 8 chunks from one place" goal without the fragility.
- **Relative threshold** (e.g. keep chunks within X of the top score) - rejected in favour of the absolute floor, which also does double duty as the "do we have anything at all?" gate. The prototype showed on-topic questions peak at 0.40-0.54 similarity and a deliberately off-topic one peaked at 0.17, so 0.25 cleanly separates them for this embedding model.
- **top-k of 16+** - no better answers, more tokens. 12 is the ceiling.

### 2.5 Numeric parameters

| Parameter | Value | Config key | Notes |
|---|---|---|---|
| `hnsw.ef_search` | `100` | `RAG_HNSW_EF_SEARCH` | `SET LOCAL` per query. Must exceed the candidate `LIMIT`. Recall not measurable in the prototype - see "Deferred to build". |
| candidate pool `LIMIT` | `50` | `RAG_CANDIDATE_POOL` | ~4x final k |
| final `k` | `12` | `RAG_TOP_K` | max chunks reaching the LLM |
| per-book cap | `6` | `RAG_MAX_PER_BOOK` | before backfill |
| similarity floor | `0.25` | `RAG_MIN_SIMILARITY` | cosine similarity, not distance |
| low-confidence floor | `3` | `RAG_MIN_RESULTS` | below this, flag + take top `RAG_LOWCONF_K` |
| low-confidence k | `4` | `RAG_LOWCONF_K` | |

All live in `packages/config`'s `loadApiConfig()` with these defaults so tuning is a config change, not a deploy of new code.
They are **API config**, not worker config.

### 2.6 Cross-book vs single-book

Same query, one bound parameter (`$3`).
Cross-book is the default (`bookId` omitted -> `$3` is `NULL` -> the `book_id` predicate is inert).
Single-book passes the ownership-checked `bookId`.
The HNSW index is not partial on `book_id`, so the single-book path still scans the index and filters - acceptable at MVP scale (tens of books, thousands of chunks per user); revisit only if a user's library grows into six figures of chunks (map fog).

### 2.7 Open dependency on the data model

The prototype assumed `chunks` carries `book_title` and `chapter_title` denormalised, so the candidate query and the citation payload need no joins.
[Data model & schema](https://github.com/Cal3574/scriptorium/issues/3) currently denormalises only `book_id` and `user_id` onto `chunks`.
**Decision:** add `book_title` and `chapter_title` as denormalised `text` columns on `chunks`, written at chunk-insert time in the ingest `chunk` stage.
They are immutable in practice (a `PATCH /books/:id` title change is rare and the citation snapshot tolerates staleness - `queries.citations` is already a frozen snapshot).
If that denormalisation is rejected, the fallback is a two-table PK join on the 50-row candidate set, which is cheap; the spec does not hard-depend on it.
This is the one item to reconcile with #3 before the build - captured as a note on the map.

## 3. Synthesis

### 3.1 Chunk formatting

The selected chunks are numbered `[1]..[k]` in similarity order and rendered into the user message as:

```
[1] {book_title} — {chapter_title}
{chunk_text}

[2] {book_title} — {chapter_title}
{chunk_text}
...
```

The number `[n]` is the citation handle - the model cites by position in this list, not by any id.
`chunk_text` is inserted verbatim (it is already a clean ~600-token paragraph-aligned slice).

### 3.2 The prompt

**System prompt** (stored as a constant in the query service, not user-editable):

```
You are a research assistant for a personal library. You answer the reader's
question by synthesising ONLY the numbered excerpts provided. The excerpts are
passages retrieved from books the reader has uploaded.

Rules:
- Use only information found in the excerpts. Never add outside knowledge or
  speculation.
- Every substantive claim must cite its source excerpt(s) with a bracketed marker
  like [3], or [2][5] for multiple. The marker is the excerpt number.
- When the excerpts genuinely do not contain enough information to answer, say so
  plainly in one or two sentences and stop. Do not pad, do not guess, do not
  apologise at length.
- Prefer synthesis across books over summarising one excerpt at a time. Draw out
  agreements, tensions, and connections between authors when the excerpts support it.
- Answer in concise markdown. No preamble like "Based on the excerpts".
```

**User message**: `Question: {question}` then, when `lowConfidence`, a single line - `Note: retrieval returned weak matches for this question. If these excerpts do not actually address it, say the library does not seem to cover this.` - then a blank line and the formatted excerpt block from 3.1.

**Model**: `claude-sonnet-5`, `max_tokens: 1500`, streamed via `LlmClient`'s streaming interface.
No temperature override (default).

### 3.3 Citation enforcement

Enforcement is **prompt + post-parse validation**, not a tool call or structured-output constraint.
The prototype showed Claude uses positional `[n]` markers reliably - zero dangling or out-of-range markers across the whole eval set - so a hard constraint is not warranted.

After the stream completes, the service:

1. Extracts every marker with `/\[(\d{1,2})\]/g` -> the set of cited excerpt numbers.
2. Drops any marker outside `1..k` (defensive; never observed).
3. Records which excerpts were cited vs merely retrieved.

The answer is **not** rewritten or rejected if a marker is missing or malformed - the raw markdown is what streams to and is stored for the user.
Malformed-marker rate is a metric to watch in production, not a hard failure.

### 3.4 "Not enough context"

Two independent mechanisms, both validated:

- The `lowConfidence` flag from retrieval (2.4) adds the explicit note to the user message.
- The standing system-prompt rule.

Together these produced, for a deliberately off-topic question, a clean one-sentence *"The library does not seem to cover this."* with no invented content and no padding.
When `lowConfidence` is set the client still shows the (weak) retrieved chunks underneath, so the user sees why.

## 4. Response contract

The endpoint streams the events named in [API surface](https://github.com/Cal3574/scriptorium/issues/9).
This spec fixes their payloads:

| Event | Payload | Timing |
|---|---|---|
| `query_started` | `{ id }` - the `queries` row uuid | after the row is inserted with `answer = null`, before retrieval |
| `citations` | `{ citations: Citation[] }` - **all** selected chunks (2.4), in `[n]` order | after retrieval + selection, before the first token |
| `text_delta` | `{ text }` | repeated, raw markdown deltas from the LLM stream |
| `done` | `{ answer }` - the full markdown | after the stream ends; the service writes `answer` + `citations` to the row here |
| `error` | `{ message }` | on upstream failure mid-stream; the row keeps `answer = null` |

### `Citation`

```jsonc
{
  "marker": 1,                       // the [n] handle; index into this array + 1
  "chunkId": "uuid",                 // chunks.id - lets the client link back if ever needed
  "bookId": "uuid",                  // null-safe: the book still exists at query time
  "bookTitle": "The Art of War",
  "chapterTitle": "Chapter IX. The Army on the March",
  "chunkText": "..."                 // verbatim, shown under the answer
}
```

- The `citations` event and `QueryDetailDto.citations` carry the **same array** - every selected chunk, not just the ones the answer happened to cite.
  The sources panel shows all retrieved context; the `[n]` markers in the answer point into it.
- What is persisted to `queries.citations` (jsonb) is this array **minus `bookId` and `marker`** - i.e. `[{ bookTitle, chapterTitle, chunkText, chunkId }]` - matching the frozen-snapshot shape [Data model & schema](https://github.com/Cal3574/scriptorium/issues/3) already specified.
  `marker` is re-derivable from array order; `bookId` is intentionally dropped so history entries never dangle against deleted books.
- There is no separate "raw chunks payload" beyond this - `citations` **is** the raw retrieved set. The ticket's "synthesis text + structured citations + raw chunks" collapses to two fields (`answer`, `citations`) because the structured citations and the raw chunks are the same list.

### Persistence timing

- Row inserted `answer = null`, `citations = null` at `query_started`.
- On `done`: `answer` and `citations` written in one `UPDATE`.
- On `error` or client disconnect: row is left as-is (`answer = null`).
  A `null`-answer row is what the client keys on to offer "retry" (a fresh `POST /queries`, not a resume).
- No cleanup job for `null` rows in the MVP - they are cheap and visible in history as "failed".

## 5. Cost and latency

Per query, from the prototype:

- Embedding: 1 short input, negligible (<$0.0001).
- Synthesis: ~6k prompt tokens (12 chunks x ~500) + up to 1.5k output -> **~$0.04**.
- Latency: dominated by the streamed synthesis; first `text_delta` after the `citations` event is ~1-2s (retrieval is single-digit ms once the index is warm).

## 6. Deferred to build

Not decisions - tuning that needs the real pipeline and can only be done once books are ingested through it:

- **HNSW recall.** The prototype does brute-force (exact) cosine because the Docker registry was unreachable. `hnsw.ef_search = 100` against a candidate `LIMIT 50` is the starting point; confirm recall@50 vs an exact scan on a real ingested corpus and raise `ef_search` if the pool is missing chunks an exact search would return.
- **The similarity floor (0.25) and per-book cap (6).** Starting values from 4 books; re-check the floor once real user books (which are not 1910 philosophy texts) are embedded - the absolute number may shift with genre, and it is a one-line config change.
- **`max_tokens` for synthesis.** 1500 was never hit in the prototype; watch for truncated answers on genuinely broad comparative questions and raise if needed.
- **Chapter-title quality in citations** depends on [Chapter detection & book-summary strategy](https://github.com/Cal3574/scriptorium/issues/7)'s detector; coarse detection just makes citation labels less precise, it does not break retrieval.

## 7. Testing notes (for the map's "Not yet specified" testing-strategy item)

- The selection logic (2.4) is pure and deterministic given a candidate list - unit-test it directly with fixture candidate arrays: per-book cap, backfill, floor, low-confidence fallback.
- The citation post-parser (3.3) is pure - unit-test the regex against real and adversarial answer strings.
- The retrieval SQL wants an integration test against a pgvector container with a handful of fixture chunks + known embeddings (the fake `EmbeddingClient` from [Local dev environment](https://github.com/Cal3574/scriptorium/issues/10) gives deterministic vectors - assert ordering and the `user_id` / `bookId` filters).
- The synthesis call is mocked via the fake `LlmClient` for endpoint tests; the prompt itself is validated by the prototype and re-checked manually if changed.
