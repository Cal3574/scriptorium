# `chunks` retention & coverage for the Read source endpoint (#115 / #116)

Wayfinder research ticket #115, feeding the Read source-text endpoint ticket #116. Part of the read-experience map #114.
Primary source is this repo's code and schema at commit on `main` (single migration `0000_empty_raider.sql`). Research performed 2026-09-10.

The Read feature plans to stitch `chunks.chunk_text` rows (in `chunk_index` order) into per-chapter reconstructed source text.

## Bottom line (what #116 needs to know)

- **Retention: safe.** Nothing prunes, TTLs, or cleans up `chunks`. The only delete path is a user-initiated book delete (`books` row deleted, Postgres cascades `chapters` + `chunks`). A `ready` book keeps its chunks forever. [`packages/server-core/src/ingest/ingest.repository.ts:178`, `packages/worker/src/ingest/delete-processor.ts`, `migrations/0000_empty_raider.sql`]
- **Coverage: every detected chapter has a `chapters` row, but a chapter CAN legitimately have zero chunks.** Chunks link to chapters by FK (`chunks.chapter_id -> chapters.id`, `on delete cascade`). Chapter detection always produces a page range for every chapter; a chapter gets zero chunks only when that page range yields no non-whitespace markdown (empty/near-empty synthesised gap chapter, image-only pages). A `ready` book always has >= 1 chunk total (the embed stage will not complete otherwise), but not necessarily >= 1 per chapter. [`packages/worker/src/ingest/stages/chunk.stage.ts:192-215`, `ingest.repository.ts:137-170`, `packages/worker/src/ingest/stages/embed.stage.ts:24-27`]
- **`chunk_text` fidelity: verbatim Markdown, structure preserved** (GitHub-flavored: `#` headings, `-`/`*` lists, `|` tables, fenced code). Not flattened to plain text. Caveats: (1) consecutive chunks **overlap by ~80 tokens** - naive concatenation duplicates text at every boundary; the endpoint must de-overlap. (2) chunk boundaries fall on blank-line (paragraph) boundaries, so a table or code block with an internal blank line can be split across two chunks; a single >600-token paragraph is sentence-split as a last resort. [`packages/providers/src/pdf-extractor/gemini-pdf-extractor.ts:52-62`, `packages/providers/src/pdf-extractor/clean-text.ts`, `packages/worker/src/ingest/chunking/chunk-text.ts`]
- **Page ranges: `chapters.page_start` / `chapters.page_end` are the reliable source.** They are schema-nullable but the current pipeline always writes integers. `chunks.page_start` / `chunks.page_end` exist but are just a copy of the parent chapter's range (NOT per-chunk granular), so deriving a chapter range from min/max of its chunks gives the identical number and fails for zero-chunk chapters. Use the `chapters` columns directly. [`packages/database/src/schema/chapters.ts`, `chunk.stage.ts:200-212`, `ingest.repository.ts:143-167`]
- **Legacy data: none.** One migration ever; `chunks` has had its current shape since it was introduced. No seed/mock data inserts chunks. No `ready` books predate the current chunking approach. [`migrations/`, `packages/database/scripts/seed.mjs`]
- **Size ceiling:** typical detected chapter ~4k-12k tokens of stitched text (~16-50 KB); realistic worst case for a book with few detected chapters or the whole-book-as-one-chapter fallback: **100k-200k+ tokens (~0.5-1 MB)**. The endpoint needs a hard response-size cap and should page or truncate. [`chunk-text.ts:22-23`, reasoning below]

---

## 1. Retention

`chunks` rows are kept indefinitely once written. There is no cleanup job, cron, scheduled task, retention window, or TTL anywhere in the codebase.

- The worker pipeline is a fixed 6-stage list (`extract`, `identifyBook`, `chunk`, `embed`, `chapterSummary`, `bookSummary`) then finalize to `ready`. No stage deletes chunks. [`packages/worker/src/ingest/stages.ts`]
- A repo-wide search for `cron`, `cleanup`, `prune`, `retention`, `ttl`, `expire`, `@Cron`, `scheduler` finds only the S3 presigned-URL `expiresInSeconds` (unrelated). No `@nestjs/schedule` usage.
- The **only** code that removes chunks: `DeleteProcessor.process()` handles the `delete` queue job (book status `deleting`, user-initiated via `DELETE /books/:id`). It deletes the two S3 objects and then `DELETE FROM books WHERE id = $1`; Postgres cascades `chapters` and `chunks` (both FKs are `on delete cascade`) and sets `queries.book_id` null. [`packages/worker/src/ingest/delete-processor.ts:63-79`, `packages/server-core/src/ingest/ingest.repository.ts:171-180`, `migrations/0000_empty_raider.sql` FK constraints]
- Chunk-touching writes elsewhere are inserts (`writeChaptersAndChunks`) and `embedding` updates (`writeChunkEmbeddings`) only - never deletes. [`ingest.repository.ts:137-233`]
- No status transition other than a full book delete removes chunks. Re-running the pipeline on a `failed` book does **not** re-chunk: `chunkStage.isComplete()` returns `repo.hasChapters(book.id)`, so once chapter rows exist the stage is skipped entirely on every subsequent run. [`packages/worker/src/ingest/stages/chunk.stage.ts:168-170`]
- RAG reads chunks at query time (`select-chunks`, pgvector candidate query), which corroborates that they are permanent operational data, not a transient pipeline artifact. [`packages/api/src/queries/select-chunks.ts`]

**Uncertain / not in code:** no DB-level partitioning, no external archival job, no infra-level retention (Railway/pg backups aside). Nothing suggests any exists.

## 2. Coverage

**Linkage.** `chunks.chapter_id` is a non-null FK to `chapters.id` (`on delete cascade`). Chunks also carry denormalised `book_id` and `user_id` (both non-null FKs) so the RAG hot path is a single-table query. There is no page-range join - the association to a chapter is the FK, set at insert time. [`packages/database/src/schema/chunks.ts:30-42`]

**How chunking relates to chapter detection.** The `chunk` stage:

1. Runs `detectChapters()` over the extraction sidecar (per-page markdown + heading blocks + PDF outline). This always returns >= 1 `DetectedChapter`, each with a numeric `startPage`/`endPage` (Path 4 fallback = whole book as one chapter, "never fatal"). [`packages/worker/src/ingest/chapter-detection/detect-chapters.ts:660-714`]
2. For each detected chapter, slices `pageRangeMarkdown(pages, startPage, endPage)` and runs `chunkText()` on it. [`chunk.stage.ts:192-212`]
3. Writes chapters + chunks in one transaction. **The chapter row is always inserted; the chunk insert is skipped when `chapter.chunks.length === 0`.** [`ingest.repository.ts:141-167`, specifically the `if (chapter.chunks.length === 0) continue;` at line ~156]

**So every detected chapter has a `chapters` row, and `chunk_index` is assigned book-wide in chapter order** (contiguous 0..N-1 across the whole book, gaps only conceptually "belong" to a chapter via `chapter_id`). [`ingest.repository.ts:139-160`]

**When can a chapter have zero chunks?** `chunkText()` returns `[]` when `splitParagraphs(text)` produces no non-empty units - i.e. the chapter's page range contains only whitespace/blank markdown. [`chunk-text.ts:90-93`] Realistic causes:

- A **synthesised gap chapter** whose interpolated `startPage`/`endPage` collapse onto blank pages, a part-divider page, or an image-only page. [`detect-chapters.ts:523-607` interpolation, `563-570`]
- Pages that extracted to empty markdown (Gemini safety-blocked pages carry only a placeholder; image-only pages).
- Two detected chapters resolving to an inverted/degenerate range (`toDetected` clamps `endPage >= startPage`, so a zero-width range = one page; if that page is blank, zero chunks). [`detect-chapters.ts:609-635`]

**A `ready` book always has >= 1 chunk in total:** `embedStage.isComplete()` requires `total > 0 && unembedded === 0`, and the pipeline cannot finalize to `ready` without every stage complete. A book that produced zero chunks across all chapters would stall in `embedding`, not reach `ready`. [`packages/worker/src/ingest/stages/embed.stage.ts:24-27`, `run()` returns early on empty but `isComplete` stays false]

**Recommendation for #116:** treat "chapter with zero chunks" as a valid, expected state - render the chapter shell (title, page range) with an empty/"source not available for this chapter" body rather than 404-ing or erroring.

## 3. `chunk_text` fidelity

**It is verbatim source text with Markdown structure preserved**, not flattened plain text.

- **Extraction** (Gemini path, current; LlamaParse path, legacy seam): the prompt is `"Transcribe every page of this PDF to GitHub-flavored Markdown. Preserve the reading order and all headings (use \`#\`..\`######\`). Do not summarise, comment, translate, or skip anything - transcribe verbatim."` Output is per-page Markdown stored in the extraction sidecar. [`packages/providers/src/pdf-extractor/gemini-pdf-extractor.ts:52-62`]
- **Cleaning**: `cleanExtractedMarkdown()` scrubs inline presentational HTML, HTML entities, and invisible/control chars **line by line**, explicitly preserving "every Markdown marker, blank line and leading indent" (`#`, `-`, `|`, nested-list indentation, fenced code). `<br>` becomes a newline. Emphasis (`*`, `_`) is left intact in body text. [`packages/providers/src/pdf-extractor/clean-text.ts:66-91`]
- **Chunking**: `pageRangeMarkdown()` joins the selected pages' cleaned markdown with `\n\n`. `chunkText()` then:
  - splits on blank lines into "paragraph" units (`/\n\s*\n+/`), packs them greedily to ~600 tokens, and **re-joins units with `\n\n`** - so headings, list blocks, and tables that sit between blank lines pass through byte-for-byte. [`chunk-text.ts:25-30`, `98-112`]
  - only a **single paragraph larger than 600 tokens** is sentence-split (`fitUnits`), and only a paragraph the sentence splitter can't handle is left whole. A large Markdown table with no internal blank lines is one "paragraph"; if it exceeds 600 tokens it gets sentence-split, which will mangle its rows. [`chunk-text.ts:39-61`]
  - a table or fenced code block that contains a blank line will be split at that blank line across two chunks.

**Two things the endpoint must handle when stitching:**

1. **Overlap duplication.** Each chunk after the first is seeded with the trailing units of its predecessor totalling ~80 tokens (`overlapUnits`), so `chunk[n]` and `chunk[n+1]` share ~80 tokens of identical text. Naive `chunks.map(c => c.chunk_text).join('\n\n')` repeats that text at every boundary. The endpoint needs to drop the overlap - e.g. find the longest suffix/prefix match between adjacent chunks, or (cleaner) reconstruct from `pageRangeMarkdown` semantics. Note `chunkText` already drops a final chunk that is wholly contained in its predecessor. [`chunk-text.ts:63-80`, `98-120`]
2. **No cross-chunk normalisation of headings.** The chunk carries whatever heading level the page had; a chapter's own `##`/`#` heading will appear inside chunk 0's text.

**Alternative worth noting for #116:** the full per-book Markdown blob is also persisted permanently at `books.extracted_markdown_key` in S3 (`books/{userId}/{uuid}.md`), and the structured per-page sidecar at `{uuid}.extraction.json`. Stitching chunks is not the only way to reconstruct chapter source - slicing the sidecar's pages by `chapters.page_start/page_end` (exactly what the chunk stage does) gives cleaner, overlap-free text. That trades a DB read for an S3 read. [`packages/worker/src/ingest/stages/extract.stage.ts:38-60`, `packages/worker/src/ingest/stages/extraction-artifact.ts`]

## 4. Page ranges

Column reality (from `migrations/0000_empty_raider.sql` and the schema files):

| column                | type    | schema nullable? | populated by current pipeline?                                                |
| --------------------- | ------- | ---------------- | ----------------------------------------------------------------------------- |
| `chapters.page_start` | integer | yes              | **always** - `detectChapters` returns a numeric `startPage` for every chapter |
| `chapters.page_end`   | integer | yes              | **always** - numeric `endPage` for every chapter                              |
| `chunks.page_start`   | integer | yes              | always, **= parent chapter's `startPage`**                                    |
| `chunks.page_end`     | integer | yes              | always, **= parent chapter's `endPage`**                                      |

- `chapters.ts` comment says the columns are nullable because "the regex fallback may not capture a heading and LlamaParse page numbers can be missing" - but in the actual code path, `toDetected()` always assigns integer `startPage`/`endPage` (clamped `>= 1`, `endPage >= startPage`, last chapter's `endPage = pageCount`). `writeChaptersAndChunks` writes them straight through. So for any book chunked by the current worker, `chapters.page_start/page_end` are non-null. [`detect-chapters.ts:609-635`, `ingest.repository.ts:143-152`]
- `chunks.page_start/page_end` are set to `chapter.startPage` / `chapter.endPage` for **every** chunk of that chapter - they are not narrowed to the pages the chunk's text actually came from. [`chunk.stage.ts:206-211`]

**Which is more reliable / can a chapter range be derived from its chunks?** `chapters.page_start/page_end` is the authoritative, always-present source. Deriving `min(chunks.page_start)` / `max(chunks.page_end)` for a chapter returns the **identical** value (they're copies), adds a join, and returns nothing for a zero-chunk chapter. **Use `chapters.page_start` / `chapters.page_end` directly.** Do not derive from chunks.

**Caveat:** page ranges are detection output, not ground truth. Synthesised gap chapters use linearly interpolated pages; overlapping/loose ranges are possible. Adjacent chapters are contiguous by construction (`endPage = nextChapter.page - 1`), so ranges won't have gaps but a chapter's start page can include a page or two of the previous chapter's tail for synthesised chapters. [`detect-chapters.ts:587-635`]

## 5. Legacy data

No legacy risk.

- **Exactly one migration**, `migrations/0000_empty_raider.sql`, which creates `books`, `chapters`, `chunks`, `queries`, `users` in their current shape (introduced in commit `80f3231` "Contracts schemas and database schema (#19)"). `chunks` has had `chunk_index`, `chunk_text`, `page_start`, `page_end`, `token_count`, `embedding` from day one. `migrations/meta/` holds only the `0000` snapshot. [`git log -- packages/database/migrations`]
- **No schema evolution** of the chunking columns - nothing to migrate away from.
- **No seed or mock data creates chunks.** `packages/database/scripts/seed.mjs` provisions only a single dev user; its comment states "Everything else (books, chapters, chunks) is produced by the ingest pipeline, not seeded." `FakePdfExtractor` + `SAMPLE_BOOK_MARKDOWN` are test-only fixtures. [`packages/database/scripts/seed.mjs:1-4`, `packages/providers/src/pdf-extractor/fixtures/sample-book.ts`]
- Therefore every `chunks` row in any environment was written by the current `chunkStage` / `writeChaptersAndChunks` code. Any `ready` book has full, current-format chunk coverage subject only to the zero-chunk-chapter case in section 2.

**Uncertain:** whether a production DB exists with books ingested under an earlier revision of `chunkStage` itself (e.g. before a chunk-size change). The chunking config (`DEFAULT_TARGET = 600`, `DEFAULT_OVERLAP = 80`) has no migration history to check; git blame on `chunk-text.ts` would tell, but the columns and stitching contract are unchanged regardless of tuning.

## 6. Size estimate (response-size ceiling)

Chunking config: `targetTokens = 600`, `overlapTokens = 80`, tokenizer is `gpt-tokenizer` BPE (OpenAI `text-embedding-3-small`). ~1 token ≈ 4 chars of English prose. [`packages/worker/src/ingest/chunking/chunk-text.ts:22-23`, `packages/worker/src/ingest/chunking/token-count.ts`]

Net forward progress per chunk ≈ `600 - 80 = 520` tokens. A chapter of `T` tokens produces ≈ `T / 520 + 1` chunks. **Stitched with overlaps intact** ≈ `chunks * 600` ≈ `T * 1.15` (a ~15% inflation over the true chapter text). **De-overlapped** ≈ `T`.

Reference points:

- Test fixture chapters (`SAMPLE_BOOK_MARKDOWN`, `chunk.stage.spec.ts`) are a few hundred tokens each - not representative of real books.
- `mock-data/The_Pragmatic_Programmer.pdf` is 2.5 MB / ~350 pages. At ~350-450 words/page (~500-600 tokens/page) that's ~180k-210k tokens for the whole book.

Estimates for the Read endpoint:

| case                                                         | chapter text (tokens) | de-overlapped chars | stitched-with-overlap chars | ~chunks  |
| ------------------------------------------------------------ | --------------------- | ------------------- | --------------------------- | -------- |
| Typical chapter (10-25 pages)                                | 5k-15k                | ~20-60 KB           | ~23-70 KB                   | ~10-30   |
| Large chapter (40-60 pages)                                  | 24k-36k               | ~100-145 KB         | ~115-165 KB                 | ~46-70   |
| Few-chapter book: 2-3 detected chapters over a 300-page book | 60k-100k each         | ~240-400 KB         | ~275-460 KB                 | ~115-190 |
| **Worst case: Path 4 fallback (whole book = 1 chapter)**     | 150k-210k             | **~0.6-0.85 MB**    | **~0.7-1.0 MB**             | ~290-400 |

**Recommendation for #116:**

- Assume a chapter response can be **up to ~1 MB / ~200k tokens** in the pathological single-chapter case. Do not return unbounded chapter text in one payload.
- Put a hard cap (e.g. 250-500 KB) on the stitched body and paginate by chunk-index range, or return the chunk list with a `hasMore` cursor, so the client can lazy-load a long chapter.
- The common case (typical chapter, tens of KB) is fine to return whole.
- De-overlapping saves ~13-15% and, more importantly, is required for correctness (section 3).

---

## Appendix: relevant files

- `packages/database/src/schema/chunks.ts`, `chapters.ts`, `books.ts`, `enums.ts` - table shapes
- `packages/database/migrations/0000_empty_raider.sql` - the only migration; FK cascade rules
- `packages/worker/src/ingest/stages/chunk.stage.ts` - the chunk stage (chapter detection + slicing)
- `packages/worker/src/ingest/chunking/chunk-text.ts` - the chunker (size, overlap, paragraph alignment)
- `packages/worker/src/ingest/chapter-detection/detect-chapters.ts` - chapter detection & page ranges
- `packages/worker/src/ingest/stages/extract.stage.ts`, `extraction-artifact.ts` - upstream markdown extraction + persisted blob/sidecar
- `packages/worker/src/ingest/stages/embed.stage.ts` - why a `ready` book always has >= 1 chunk
- `packages/worker/src/ingest/delete-processor.ts` - the only chunk-delete path
- `packages/server-core/src/ingest/ingest.repository.ts` - `writeChaptersAndChunks`, `deleteBook`, chunk queries
- `packages/providers/src/pdf-extractor/gemini-pdf-extractor.ts`, `clean-text.ts` - verbatim-markdown extraction + cleaning
- `packages/api/src/queries/select-chunks.ts` - RAG read path (evidence chunks are permanent operational data)
- `packages/database/scripts/seed.mjs` - proves no chunks are seeded
