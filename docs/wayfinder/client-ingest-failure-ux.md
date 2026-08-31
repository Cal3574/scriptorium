# Client ingest-failure UX

Resolution of the closing grilling ticket [Grill the Scriptorium MVP map to a close](https://github.com/Cal3574/scriptorium/issues/15) (part of [Wayfinder map: Scriptorium MVP](https://github.com/Cal3574/scriptorium/issues/2)).

This locks how a book that fails during ingest is surfaced to the user on the client.
The server side is already locked by [API surface](https://github.com/Cal3574/scriptorium/issues/9), [Ingest job spec](https://github.com/Cal3574/scriptorium/issues/8), and [Data model & schema](https://github.com/Cal3574/scriptorium/issues/3); this doc owns only the React treatment.

## 1. What the server already provides

- `BookDto` / `BookListItemDto` carry `status: 'failed'`, plus `failedStage` (for example `'extract'`, `'embed'`, `'chapterSummary'`) and `failureReason` (an internal string, for example `"LlamaParse: PDF_IS_PROTECTED"`).
- The SSE `book_failed` event fires on `GET /books/:id/events` when a book fails mid-pipeline.
- `POST /books/:id/retry` is valid only from `status = 'failed'` (else `409` / `book_not_failed`).
  It re-enqueues the ingest job, which skips already-completed stages (derive-from-data), so only unfinished work is redone.
- A failed book **keeps whatever partial data it produced**: chapters may exist, some `chapters.summary` values may be set, `books.summary` may be null.

## 2. Friendly stage labels

`failedStage` is mapped to a human label for display.
The raw value is never shown as a headline.

| `failedStage` | Label |
| --- | --- |
| `extract` | Failed while reading the PDF |
| `identifyBook` | (never fails the book; non-fatal) |
| `chunk` | Failed while splitting into chapters |
| `embed` | Failed while indexing for search |
| `chapterSummary` | Failed while summarising chapters |
| `bookSummary` | Failed while writing the book summary |
| `null` (unknown) | Processing failed |

## 3. Screen by screen

### Library

- A failed book renders as a normal row with a muted / red status pill showing the friendly label.
- The row has an inline **Retry** button and the existing inline **Delete**.
- No auto-retry. The user chooses.

### Upload (live progress)

- If `book_failed` arrives on the SSE stream while the user is watching progress:
  - the progress indicator stops and switches to an error state,
  - it shows the friendly stage label,
  - `failureReason` is shown verbatim inside a collapsible "Show details" line, collapsed by default,
  - two actions: **Retry** and **Back to library**.

### Book detail

- A failed book is still openable.
- A banner at the top of the page: the friendly stage label, plus `failureReason` behind a "Show details" toggle, plus a **Retry** button.
- Below the banner, whatever partial data exists is rendered normally:
  - detected chapters are listed,
  - a chapter with no summary shows the same muted "Not generated yet" state used for in-progress books,
  - the book summary section shows "Not generated yet" if `books.summary` is null.
- Nothing is hidden. The failure is additive information, not a blocking wall.

## 4. After a retry

- `POST /books/:id/retry` returns `200` with the book back in a processing state.
- The screen the user retried from reverts to the normal live-progress view and re-subscribes to `GET /books/:id/events`.
- The failure banner / error state is cleared.

## 5. `failureReason` handling

- Always shown to the user, but always behind a "Show details" toggle.
- It is a useful internal string (upstream error codes, our own messages) but not a headline.
- No parsing or prettifying of `failureReason` on the client; it is displayed as received.

## 6. Out of scope

- Distinguishing retryable from terminal failures in the UI.
  Every `failed` book offers Retry; a genuinely terminal failure will simply fail again at the same stage, which is acceptable for the MVP.
- Any automated or scheduled retry.
- Partial-book affordances beyond rendering what exists (for example "summarise just this chapter").
  The only recovery paths are Retry and delete plus re-upload, per [API surface](https://github.com/Cal3574/scriptorium/issues/9).
