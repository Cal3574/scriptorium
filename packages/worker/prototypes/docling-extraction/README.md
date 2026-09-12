# Docling extraction pre-flip validation

A manually run tool that measures docling PDF extraction against the Gemini
extraction it is replacing, before docling is trusted as the only live PDF
extractor.
It is **not** a CI test - it hits a real docling-serve instance and real S3 -
and is kept out of the app build like the other prototypes.

## What it does

For every `*.pdf` in a folder it:

1. runs the real `DoclingPdfExtractor` (the shipped adapter, not a
   reimplementation),
2. loads that book's already-persisted Gemini extraction sidecar from S3 (the
   baseline - see "The manifest" below),
3. runs the real `detectChapters` over both the docling and the baseline
   extraction,
4. prints a per-book row: page count, share of pages whose docling word count
   is within 10% of the baseline, heading counts, and both chapter counts,
5. prints both chapter lists so a mismatch is easy to eyeball.

## The manifest

Docling has no per-book Gemini baseline of its own to compare against, so this
script needs to know which already-ingested book each sample PDF corresponds
to. Put a `manifest.json` next to the sample PDFs:

```json
{
  "clean-novel.pdf": "books/<userId>/<uuid>.pdf",
  "dense-nonfiction.pdf": "books/<userId>/<uuid>.pdf"
}
```

The value is the book's `s3Key` (as stored in the `books` table) - the script
derives the extraction sidecar key from it the same way the ingest pipeline
does.

## Running

```sh
export DOCLING_URL=...                       # your docling-serve base URL
export S3_BUCKET=... S3_REGION=...
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
# optional: DOCLING_DOCUMENT_TIMEOUT_SECONDS
node --import @swc-node/register/esm-register \
  packages/worker/prototypes/docling-extraction/validate.ts ~/books/sample-set
```

## The sample set

Reuse the same ~10 hand-picked PDFs the Gemini validation used: a clean
single-column novel, dense non-fiction with footnotes, one with tables, a
scanned/image-only PDF, one with edgy content (literary violence, sexual
content, quoted slurs) - as long as each was already ingested live (so a
Gemini baseline exists in S3 to compare against).

## Pass bar

- at least **95%** of pages within **10%** word count of the Gemini baseline,
- **zero** fully-missing pages (word count 0 where the baseline has text),
- `detectChapters()` chapter count matches the baseline's on **at least 8 of
  10** books.

Scanned PDFs are eyeballed only - compare the docling chapter list and page
counts against what you know of the book, since the Gemini baseline itself was
never validated against ground truth for those.

Clears the bar -> merge. Borderline -> add a production shadow-comparison pass
before committing to full retirement of the Gemini/LlamaParse adapters, or
tune docling's `do_ocr` / `table_mode` options and re-run.
