# Gemini extraction pre-flip validation

A manually run tool that measures Gemini PDF extraction against ground truth
before `PDF_EXTRACTOR=gemini` is trusted in a deployed worker.
It is **not** a CI test - it makes real, paid Gemini calls - and is kept out of
the app build like the other prototypes.

## What it does

For every `*.pdf` in a folder it:

1. runs the real `GeminiPdfExtractor` (the shipped adapter, not a
   reimplementation),
2. runs a local `pdfjs-dist` raw-text pass (`getTextContent()`) per page,
3. runs the real `detectChapters` over the Gemini extraction,
4. prints a per-book row: page count, share of pages whose Gemini word count is
   within 10% of the pdfjs text layer, heading count, placeholder count
   (safety-blocked pages), and the detected chapter list,
5. dumps the full Gemini markdown for any page flagged low-ratio, into
   `./out/<book>/page-<n>.md`.

Put a `<book>.toc.txt` next to a PDF (one chapter title per line) and the script
prints it beside the detected chapters for eyeballing.

## Running

```sh
export GEMINI_API_KEY=...            # AI Studio key
# optional: GEMINI_MODEL, GEMINI_PAGES_PER_BATCH, GEMINI_BATCH_CONCURRENCY
node --import @swc-node/register/esm-register \
  packages/worker/prototypes/gemini-extraction/validate.ts ~/books/sample-set
```

## The sample set

~10 hand-picked PDFs spanning the range: a clean single-column novel, dense
non-fiction with footnotes, one with tables, a scanned/image-only PDF, one with
edgy content (literary violence, sexual content, quoted slurs).

## Pass bar

For **born-digital** books (non-empty pdfjs text layer):

- at least **95%** of pages within **10%** word count of the pdfjs text layer,
- **zero** fully-missing pages (word count 0 where pdfjs has text),
- `detectChapters()` chapter count matches the book's TOC on **at least 8 of
  10** books.

**Scanned** PDFs (empty text layer) are eyeballed only - compare the dumped
markdown against the page images.

Clears the bar -> flip `PDF_EXTRACTOR` to `gemini` in the worker environment (it
is already the committed default, so this is just removing the override).
Borderline -> add a production shadow-comparison pass before committing, or step
`GEMINI_MODEL` up to the next Flash-Lite tier and re-run.
