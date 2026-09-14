# Chunk citation columns (#11 to #3 reconciliation)

Resolution of the closing grilling ticket [Grill the Scriptorium MVP map to a close](https://github.com/Cal3574/scriptorium/issues/15) (part of [Wayfinder map: Scriptorium MVP](https://github.com/Cal3574/scriptorium/issues/2)).

This settles the one open dependency the [RAG query spec](https://github.com/Cal3574/scriptorium/issues/11) left against [Data model & schema](https://github.com/Cal3574/scriptorium/issues/3) (§2.7 of the RAG spec).

## Decision

`chunks` **gains two denormalised columns**:

- `book_title text NOT NULL`
- `chapter_title text NOT NULL`

Both are written at chunk-insert time in the ingest `chunk` stage, from the values already in memory (the book title and the detected chapter title).

The RAG candidate query and the citation payload therefore read everything from `chunks` alone.
No join to `books` or `chapters` on the retrieval path.
This matches the reason `chunks` already carries denormalised `book_id` and `user_id`: the cross-book RAG query is a single-table scan.

## Staleness

`books.title` is mutable: `PATCH /books/:id` can change it, and the `identifyBook` stage LLM-backfills it.
A denormalised `chunks.book_title` therefore drifts from `books.title` after a rename.

This is accepted:

- The drift is cosmetic: it only affects the book label in the sources panel, and only for **new** queries.
- Query history is unaffected: `queries.citations` is already a frozen jsonb snapshot taken at query time.
- Re-chunking or re-embedding on every title edit would be absurd for a label.
- A comment on the column in the schema records this.

`chapters.title` is effectively immutable once detected, so `chunks.chapter_title` never drifts.

## Action for the build

- The `packages/database` schema and the **first migration** must include `chunks.book_title` and `chunks.chapter_title` as above.
- The `chunk` stage populates them on insert.
- The RAG candidate query in `packages/api` selects them directly; the two-table PK-join fallback described in RAG spec §2.7 is **not** implemented.
