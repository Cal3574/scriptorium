# Chapter detection & book-summary strategy

Spec section produced by wayfinder ticket [#7](https://github.com/Cal3574/scriptorium/issues/7).
Validated by a throwaway prototype run against a real book PDF: `packages/worker/prototypes/chapter-detection/` (branch `prototype/chapter-detection`).

Test book: `The Pragmatic Programmer`, 1st edition (1999), 324 PDF pages, digitally authored, single column, clean text.
LlamaParse tier: cost-effective (`parse_page_with_llm` / `tier: cost_effective`), one parse, ~105 seconds, ~900 credits.

## 1. Prototype findings

### 1.1 LlamaParse heading levels are not document structure

The `items` output tags heading blocks with a markdown level (`#` = 1, `##` = 2).
On the test book the levels are assigned per page from visual size, not from the book's outline.
Counts: 104 level-1 headings, 346 level-2, 13 level-3.
The two author names on the title page ("Andrew Hunt", "David Thomas") are level-1 headings; so are roughly half the in-chapter section titles.

Conclusion: never key chapter detection off the heading level.

### 1.2 The reliable signal is the chapter-title text

A block is a chapter marker when all of the following hold:

- `type === "heading"` (paragraph/text blocks that mention "Chapter" are prose, e.g. "Appendix A contains a set of resources ...").
- Its text matches `^(chapter|appendix|part)\s+(\d{1,2}|[A-Z]|[IVXLC]{1,5})[.:]?\s+(.+)` (case-insensitive).
- Text length <= 60 characters (a real title is short; a sentence is not).
- Not on a table-of-contents page (see 1.3).
- No trailing page number or dot leader (`(\s+|\.{2,}\s*)\d{1,4}\s*$`), which also marks a TOC line.

On the test book this yielded 9 of 9 real markers with correct consecutive page ranges:
chapters 2-8 and appendices A and B, each with a start page and an end page derived from the next marker's start page minus one.
LlamaParse exposes no page-range field (per research ticket #5), so the range is always derived this way.

### 1.3 Table-of-contents pages

A page is treated as TOC when it is within the first `max(20, ceil(pageCount * 0.1))` pages
and carries at least 3 short lines (< 90 chars) ending in a page number or a dot leader followed by a page number.
On the test book this correctly flagged pages 6 and 11 and kept their fake "Chapter N" lines out of the result.

### 1.4 One genuine detection failure, and the fix

"Chapter 1. A Pragmatic Philosophy" is completely absent from the LlamaParse output.
Its opener page produced no heading block at all; the text runs straight from "Acknowledgments" into the first topic of chapter 1.

This is caught by gap detection: the detected chapter numbers were 2, 3, 4, 5, 6, 7, 8, so 1 is missing.
The pipeline synthesises a chapter for every gap in the 1..max(n) run, spanning from the end of the front matter (or the previous marker) to the next detected marker.
The synthesised chapter's title is filled from the pdfjs outline (1.5) if present, otherwise by a single Claude call over the first ~500 tokens of the chapter, otherwise left as "Chapter 1".

### 1.5 Front matter

Headings before the first chapter marker that match
`^(contents|copyright|dedication|foreword|preface|acknowledge?ments?|about the authors?|introduction)`
are classified as front matter and excluded from the chapter list.
On the test book: Preface, Acknowledgments.

### 1.6 Whole-book summary: token budget

The full markdown of the 324-page test book counted at 194,579 tokens (`messages.count_tokens`, `claude-sonnet-5`).
This fits the 1M context window but not a 200K one.
A denser 600-page book would land near 350-400K tokens, still inside 1M but well past the point where a single pass is comfortable.

Measured, `claude-sonnet-5`, this run:

| Strategy | Input tokens | Output tokens | Wall time | Cost |
| --- | --- | --- | --- | --- |
| A: single pass over full markdown | 194,685 | 1,437 | 24 s | $0.40 |
| B: map (9 chapter deep dives) | 168,648 | 14,151 | ~60 s at concurrency 3 | $0.48 |
| B: reduce (book summary from the 9 chapter summaries) | 14,275 | 1,406 | 19 s | $0.04 |

The chapter deep dives are a required product output regardless of how the book summary is made.
So strategy B's book summary is a $0.04 / 19 s addition to work already done, versus a $0.40 separate pass, and its reduce-step input stays ~15K tokens no matter how large the book is.
Output quality was equal or slightly better than the single pass.

### 1.7 Chapter deep-dive input: raw text, not chunks

Slicing chapter 3 (34 pages, ~17K tokens) into ~600-token paragraph-aligned chunks and rejoining them is lossless.
Feeding the model the chunks instead of the raw chapter markdown adds nothing and costs the same.
The deep-dive prompt takes the raw chapter markdown.
Chunks exist only for RAG retrieval.

## 2. Spec

### 2.1 Chapter detection (in the `chunk` stage of the ingest job)

Input: the LlamaParse result cached from the `extract` stage: per-page markdown, `items` blocks, `metadata` (for `extract_printed_page_number`).
Plus the PDF outline read with `pdfjs-dist` `getOutline()`.

Algorithm:

1. Flatten `items.pages[].items[]` carrying each block's `page_number`.
2. Identify TOC pages (rule 1.3) and front-matter headings (rule 1.5).
3. Collect chapter markers (rule 1.2): kind, number, title, start page.
4. Read the pdfjs outline. It is a nested `{title, dest -> pageIndex}` tree and is the only real chapter tree for digitally authored PDFs (research #5). Use it to:
   - corroborate marker pages (prefer the LlamaParse page when they disagree by <= 2, else trust the outline),
   - supply titles for synthesised chapters,
   - act as the primary chapter list when step 3 finds fewer than 2 markers.
5. Fill numbering gaps (rule 1.4) by synthesising a chapter per missing number.
6. Derive each chapter's end page from the next chapter's start page minus one; the last chapter ends at the last page.
7. Fallback ladder when steps 3 and 4 both come up empty:
   a. segment on the largest cluster of same-size headings,
   b. failing that, treat the whole book as a single chapter.
8. A book that reaches step 7b and still has zero usable structure is not a terminal failure; it ingests as one chapter (the `identifyBook`-style non-fatal rule from #8).

Output: ordered `chapters` rows, each with `title`, `chapter_index`, `start_page`, `end_page`.
Sub-chapter chunking then runs per chapter over the markdown pages in that range, unchanged from the data-model spec (#3).

### 2.2 Chapter content storage

No `chapters.content` column.
The chapter's raw markdown is sliced on demand from the permanent S3 markdown blob (`books.extracted_markdown_key`, per #3) using `start_page` / `end_page`.
This is the same blob the re-chunk path already reads, so nothing new is persisted and a ~600 KB book is not duplicated into Postgres.
`chapters` gains `start_page int` and `end_page int` (nullable, by migration) if the data-model schema does not already carry them.

### 2.3 Chapter deep-dive

Runs in the `chapterSummary` stage, once per chapter, concurrency 3, write-back per chapter (matches #8).

- Model: `claude-sonnet-5` (settled stack).
- Input: the raw chapter markdown sliced by page range (2.2).
- System prompt: deep-dive summary of one chapter for a personal knowledge base. Markdown out: 2-3 sentence overview, then 4-8 key points with the author's reasoning, then any concrete practices or rules named. No preamble.
- `max_tokens`: 4000.
- Output stored in `chapters.summary` as markdown `text`. Not `jsonb`; the client renders it as one expandable block and has no need to address sub-sections.
- A chapter that fails all in-stage retries fails the book (matches #8).

### 2.4 Whole-book summary: map-reduce

The book summary is the reduce over the chapter deep-dives.

- Model: `claude-sonnet-5`.
- Input: the concatenation of the per-chapter summaries produced by `chapterSummary`, each prefixed with `## <chapter title>`.
- System prompt: high-level summary for a personal knowledge base. Markdown out: one-paragraph thesis, then 5-9 bullet key ideas, then 3-5 bullets on how the ideas connect. No preamble.
- `max_tokens`: 4000.
- Output stored in `books.summary` as markdown `text` (not `jsonb`, same reason as 2.3).

### 2.5 Ingest stage order (correction to #8)

The ingest job spec (#8) lists the pipeline as
`extract -> identifyBook -> chunk -> embed -> bookSummary -> chapterSummary -> ready`.

Because the book summary is now the reduce over the chapter summaries, the last two stages swap:

`extract -> identifyBook -> chunk -> embed -> chapterSummary -> bookSummary -> ready`

Everything else in #8 stands: both summary stages still sit under the `summarizing` display status, derive-from-data resumption is per stage (`bookSummary` resumes when `books.summary` is null; `chapterSummary` resumes over `chapters` where `summary is null`), and `bookSummary` now additionally requires every chapter's `summary` to be set before it can run.

### 2.6 Cost and latency per book (order-of-magnitude, from the 324-page run)

- LlamaParse cost-effective: ~900 credits (~$1.13) for ~300 pages, ~2 minutes.
- Embeddings: per the data-model / ingest specs, not re-measured here.
- Claude, `claude-sonnet-5`: ~$0.50 per book (9 chapter deep dives + 1 book summary), ~90 seconds of model wall time at concurrency 3.
- Total variable cost per ~300-page book is on the order of $1.60 plus embeddings.

## 3. Feeds into other tickets

- [#8 Ingest job spec](https://github.com/Cal3574/scriptorium/issues/8): stage order correction (2.5), commented on the issue.
- [#11 RAG query spec](https://github.com/Cal3574/scriptorium/issues/11): chunks are confirmed RAG-only; chapter titles and page ranges are available for citations.
- Data model (#3): add `chapters.start_page` / `chapters.end_page` if absent; `books.summary` and `chapters.summary` stay `text`.
- Not-yet-specified "testing strategy": the detection algorithm (2.1) is the part that most needs fixture-based tests, using cached LlamaParse fixtures like the prototype's `.cache/`.
