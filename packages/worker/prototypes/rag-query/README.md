# THROWAWAY PROTOTYPE - RAG query spec

Answers wayfinder ticket [#11](https://github.com/Cal3574/scriptorium/issues/11). **Not production code.**
Delete once the spec section has landed and the real query endpoint is built.

Lives next to `packages/worker` because the retrieval + synthesis logic is worker/API-adjacent.

## The question

Pin down the RAG query internals the API surface (#9) left open: distance metric & operator,
top-k, similarity threshold, chunk de-duplication / diversity, the cross-book vs single-book
SQL, the synthesis prompt (chunk formatting, `[n]` citation enforcement, "not enough context"),
and the response contract.

## What it does

1. `1-fetch.mjs` - downloads 4 public-domain books from Project Gutenberg with deliberate
   thematic overlap (thinking / method / strategy) so cross-book synthesis has real material:
   *How We Think* (Dewey), *Thinking as a Science* (Hazlitt), *The Art of War* (Sun Tzu),
   *The Prince* (Machiavelli).
2. `2-ingest.mjs` - chapter-splits, ~600-token paragraph-aligned chunks (~80 overlap),
   real OpenAI `text-embedding-3-small` 1536-d embeddings, persisted to `chunks.json`
   (478 chunks, ~$0.005).
3. `3-retrieve.mjs` - runs candidate retrieval strategies over `eval-questions.json` and
   prints similarity distribution, book/chapter spread, and token load per strategy.
   `node 3-retrieve.mjs RECOMMENDED` also dumps the picked chunks to eyeball.
4. `4-synthesize.mjs "your question"` - full pipeline: retrieve -> synthesis prompt ->
   streamed `claude-sonnet-5` -> prints the answer, the `citations` payload, and a
   contract check (which `[n]` markers the answer used, any dangling markers).

## Run

```
cd packages/worker/prototypes/rag-query
ln -s ../../.env .env          # needs OPEN_AI_API_KEY + ANTHROPIC_API_KEY
pnpm install --ignore-workspace
node 1-fetch.mjs
node 2-ingest.mjs
node 3-retrieve.mjs
node 4-synthesize.mjs
```

## Not pgvector

The Docker registry is unreachable in this environment, so the embedded corpus lives in
`chunks.json` and retrieval is brute-force cosine in JS - exact (full recall), fast at this
size. What this prototype therefore does **not** measure: HNSW recall/latency and
`hnsw.ef_search`. Those are a build-time tuning task (see the spec's "Deferred to build").
Retrieval *strategy* is independent of the index and is what this validated.

## Findings

See `docs/wayfinder/rag-query-spec.md` and the resolution comment on issue #11. Headlines:

- Cosine similarity is compressed: on-topic questions peak at **0.40-0.54**, a deliberately
  off-topic question ("Arctic tern migration") peaked at **0.17**. Clean separation -> an
  absolute floor of **~0.25** is a usable "do we have anything?" gate. The 0.7+ thresholds
  people assume are wrong for this embedding model.
- Most good answers come from **one** book; only genuinely comparative questions spread
  across 3. Forcing diversity (MMR) hurt more than it helped at this corpus size - it pulls
  in weaker chunks. **MMR is not worth the complexity.**
- A per-*chapter* cap starves results when chapter segmentation is coarse. A per-*book* cap
  of ~6 with backfill is the right diversity lever, and it only binds on multi-book pools.
- **Recommended:** cosine top-k=12 from a 50-candidate pool, per-book cap 6 + backfill,
  absolute floor 0.25; if <3 survive the floor, take top 4 and flag `lowConfidence`.
- Claude uses positional `[n]` markers into the excerpt list reliably - zero dangling
  markers across the eval set. Post-parse with `/\[(\d{1,2})\]/g`.
- The "not enough context" path works: `lowConfidence` flag + an explicit prompt rule
  produced a clean one-sentence "the library does not seem to cover this" with no padding.
- ~6k prompt tokens + ~1.5k output => **~$0.04 / query**.
