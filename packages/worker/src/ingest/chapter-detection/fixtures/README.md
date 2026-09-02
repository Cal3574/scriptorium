# Chapter-detection fixtures

Each case is a pair:

- `<name>.detection-input.json` - the shape `detectChapters()` consumes: the
  LlamaParse result reduced to `{ pages, items, metadata, pageCount }` plus the
  `pdfjs-dist` `outline` tree.
- `<name>.expected.json` - the `DetectedChapter[]` the detector must return for
  that input (no `resolveGapTitle` hook, so synthesised gaps fall through to
  `Chapter N` unless the outline names them).

The synthetic cases here are hand-authored to pin one behaviour each:

| fixture                     | pins                                             |
| --------------------------- | ----------------------------------------------- |
| `missing-chapter-one`       | a gap at chapter 1 is synthesised from page 1    |
| `toc-exclusion`             | markers on a table-of-contents page are dropped |
| `author-name-headings`      | front-matter headings never become chapters     |
| `sparse-markers`            | < 2 markers -> the outline is the chapter list  |
| `zero-structure`            | no markers, no outline -> whole book, one chapter |

## Regenerating from a real capture

`packages/worker/prototypes/chapter-detection/regen.mjs` turns a real LlamaParse
JSON capture plus its PDF into a `*.detection-input.json`. See that script's
header for usage. The full _Pragmatic Programmer_ capture is intentionally not
committed here yet - it needs the licensed PDF and a `LLAMAPARSE_API_KEY`; drop
`pragmatic-programmer.detection-input.json` + `.expected.json` in once captured
and the spec picks it up automatically.
