# API surface

Resolution of wayfinder ticket [API surface](https://github.com/Cal3574/scriptorium/issues/9) (part of [Wayfinder map: Scriptorium MVP](https://github.com/Cal3574/scriptorium/issues/2)).

This locks the full HTTP API for the Scriptorium MVP: every endpoint, its method and path, request and response shape, auth requirement, ownership guard, the validation mechanism, the error response format, and the cross-cutting concerns (CORS, request correlation, status-code conventions).

The SSE progress stream and the delete flow are specified elsewhere and only referenced here:

- SSE progress event contract: [Ingest job spec](https://github.com/Cal3574/scriptorium/issues/8).
- Delete job behaviour and `book_status` transitions: [Data model & schema](https://github.com/Cal3574/scriptorium/issues/3).

The RAG retrieval and synthesis internals (top-k, prompt, token budget) are owned by [RAG query spec](https://github.com/Cal3574/scriptorium/issues/11); this doc owns only the HTTP contract of `POST /queries`.

## Conventions

### Prefix and versioning

- Global prefix **`/api/v1`**. Every application endpoint lives under it (`/api/v1/books`, `/api/v1/queries`, ...).
- `GET /health` is the **one exception** - it sits at the root, outside the prefix, so infra liveness checks do not depend on the version segment.
- Versioning is a URL path segment (`v1`). A future breaking change ships as `/api/v2` alongside `v1`; there is no header-based or content-negotiated versioning.

### Validation and contract sharing

- All request and response shapes are **Zod schemas** in `@scriptorium/contracts` (the one lib the client may import - see [Monorepo package layout](https://github.com/Cal3574/scriptorium/issues/4)).
- The API wires them in with **`nestjs-zod`**: request DTOs are `createZodDto(Schema)` classes, a global `ZodValidationPipe` validates body / query / params, and response DTOs are the same schemas parsed inside the mapper functions (`toBookDto`, `toChapterDto`, ...) before serialization.
- The client imports the identical schemas for form validation and to type `fetch` responses. No shape is written twice.
- A schema failure on an incoming request produces **`422 Unprocessable Entity`** (valid JSON, fails the schema), distinct from **`400 Bad Request`** (not valid JSON at all).

### Authentication

- A **global `ClerkAuthGuard`** runs on every request. It:
  1. reads the bearer token from the `Authorization` header and verifies it with `@clerk/backend` `verifyToken` (networkless, per [Clerk integration](https://github.com/Cal3574/scriptorium/issues/6)),
  2. JIT-upserts the local `users` row keyed on `clerk_user_id` (Clerk `sub`), refreshing `email`,
  3. attaches `req.user = { id, clerkUserId, email }` where `id` is the **local** `users.id` - the ownership key for every authorization check.
- An **`@Public()`** decorator opts a route out of the guard. Only two routes are public:
  - `GET /health`,
  - `GET /api/v1/books/:id/events` - the SSE stream, which `EventSource` cannot send an `Authorization` header for. It takes the token as `?token=` and verifies it manually inside the handler (per [Ingest job spec](https://github.com/Cal3574/scriptorium/issues/8)).
- Missing or invalid token on a guarded route -> **`401 Unauthorized`**.

### Authorization (ownership guard)

- Every `:id`-addressed book or query resource is checked: `resource.user_id === req.user.id`.
- A resource that is absent **or** owned by another user returns an **identical `404 Not Found`**. The API never discloses that an ID exists for a different user - there is no `403`.
- Applies to `GET /books/:id`, `PATCH /books/:id`, `POST /books/:id/retry`, `DELETE /books/:id`, `GET /books/:id/events`, `GET /queries/:id`, and the optional `bookId` filter on `POST /queries`.

### Error response format

All non-2xx responses use **RFC 9457 Problem Details**:

- `Content-Type: application/problem+json`
- Body:

  ```json
  {
    "type": "https://scriptorium.app/problems/book-not-ready",
    "title": "Book is not ready",
    "status": 409,
    "detail": "This book is still processing and cannot be retried.",
    "code": "book_not_ready",
    "instance": "0c5f7e2a-...",
    "errors": [{ "path": "title", "message": "String must contain at most 500 character(s)" }]
  }
  ```

- `code` is a **stable machine-readable string** the client switches on (`book_not_found`, `book_not_ready`, `upload_not_found`, `question_too_long`, `not_a_pdf`, `file_too_large`, `upstream_failure`, ...). `title` / `detail` are human text and may change.
- `instance` is the request's `X-Request-Id`.
- `errors` is present only on `422` schema failures - the flattened Zod issues.
- Implemented as a **single Nest exception filter** mapping `ZodValidationException` -> `422 + errors`, domain exceptions (`BookNotFoundException`, `BookNotFailedException`, `UploadNotFoundException`, ...) -> their status + `code`, and anything unhandled -> a generic `500` Problem with no internal detail leaked.

### Status-code conventions

| Code | Meaning in this API |
|---|---|
| `200` | read / update / retry OK |
| `201` | `POST /books` created a book; `POST /queries` - n/a (streams) |
| `202` | `DELETE /books/:id` accepted (async delete job) |
| `400` | request body is not valid JSON |
| `401` | missing / invalid Clerk token on a guarded route |
| `404` | resource missing **or** owned by another user |
| `409` | wrong-state operation (retry a book that is not `failed`) |
| `422` | valid JSON that fails a Zod schema or a business rule (not a PDF, file too large, S3 object not found, question too long) |
| `502` | synchronous upstream failure (LlamaParse / OpenAI / Claude) - in practice only the `POST /queries` path can surface one to the caller |

### Pagination

**None anywhere in the MVP.** `GET /books` and `GET /queries` return flat, newest-first arrays. The data model notes tens of books per user; query history is similarly small. Revisit if query history grows unbounded (tracked as fog on the map).

### CORS

- The client is static on CloudFront; the API is behind Traefik on the VPS - every browser call is cross-origin.
- `app.enableCors` with:
  - `origin`: a **single** allowed origin from config (`CLIENT_ORIGIN`), never `*`,
  - `methods`: `GET,POST,PATCH,DELETE,OPTIONS`,
  - `allowedHeaders`: `Authorization,Content-Type,Accept`,
  - `credentials: false` - auth is a bearer header, not a cookie,
  - preflight cached 24h.

### Request correlation

- Per-request middleware assigns an **`X-Request-Id`** (uuid v4), or reuses the client-supplied `X-Request-Id` header if present.
- Echoed on the response header, embedded as `instance` in any Problem Details body, and bound to the logger context for the request.
- Passed into the BullMQ job `data` on `POST /books` and the delete job, so one ID traces an upload through the API and the entire worker ingest pipeline.

## Endpoint reference

| Method & path | Auth | Request | Success | Errors |
|---|---|---|---|---|
| `GET /health` | Public | - | `200 { "status": "ok" }` | - |
| `GET /api/v1/me` | Bearer | - | `200` `UserDto` | `401` |
| `POST /api/v1/books/upload-url` | Bearer | `CreateUploadUrlRequest` | `200` `CreateUploadUrlResponse` | `401`, `422` (`not_a_pdf`, `file_too_large`) |
| `POST /api/v1/books` | Bearer | `CreateBookRequest` | `201` `BookDto` | `401`, `422` (`upload_not_found`, `s3_key_mismatch`, `file_size_mismatch`) |
| `GET /api/v1/books` | Bearer | - | `200` `BookListItemDto[]` (newest-first) | `401` |
| `GET /api/v1/books/:id` | Bearer + owner | - | `200` `BookDetailDto` | `401`, `404` |
| `PATCH /api/v1/books/:id` | Bearer + owner | `UpdateBookRequest` | `200` `BookDto` | `401`, `404`, `422` (`no_fields`, field length) |
| `POST /api/v1/books/:id/retry` | Bearer + owner | - | `200` `BookDto` | `401`, `404`, `409` (`book_not_failed`) |
| `DELETE /api/v1/books/:id` | Bearer + owner | - | `202` (empty body) | `401`, `404` |
| `GET /api/v1/books/:id/events` | Public + `?token=` | - | `200` `text/event-stream` | `401` (bad `token`), `404` |
| `POST /api/v1/queries` | Bearer | `CreateQueryRequest` + `Accept: text/event-stream` | `200` `text/event-stream` | `401`, `404` (bad `bookId`), `422` (`question_too_long`), `502` (`upstream_failure`) |
| `GET /api/v1/queries` | Bearer | - | `200` `QueryListItemDto[]` (newest-first) | `401` |
| `GET /api/v1/queries/:id` | Bearer + owner | - | `200` `QueryDetailDto` | `401`, `404` |

## Payloads

DTOs are derived from the schema in `@scriptorium/contracts`. Raw Drizzle rows never appear - `chunk_text` / `embedding` and un-DTO'd columns are stripped by the mappers.

### `UserDto`

```json
{ "id": "uuid", "email": "reader@example.com", "createdAt": "2026-08-31T10:00:00.000Z" }
```

### Upload + create

```jsonc
// POST /api/v1/books/upload-url  -> CreateUploadUrlRequest
{ "filename": "atomic-habits.pdf", "contentType": "application/pdf", "fileSizeBytes": 8123456 }

// 200 -> CreateUploadUrlResponse
{
  "uploadUrl": "https://s3.eu-west-2.amazonaws.com/scriptorium-books/books/1f0.../a1b2c3.pdf?X-Amz-...",
  "s3Key": "books/1f0e.../a1b2c3d4.pdf",
  "expiresInSeconds": 300
}
```

- Server generates `s3Key` as `books/{userId}/{uuid}.pdf`. The client never chooses the key.
- `contentType` must be `application/pdf` (`not_a_pdf`); `fileSizeBytes` must be `<= MAX_UPLOAD_BYTES` from config, default 50 MB (`file_too_large`).
- The presigned PUT is pinned to that exact key and content-type and expires in 5 minutes.

```jsonc
// Client then: PUT {uploadUrl}  (binary body, Content-Type: application/pdf)  -- direct to S3, not our API

// POST /api/v1/books  -> CreateBookRequest
{
  "s3Key": "books/1f0e.../a1b2c3d4.pdf",
  "originalFilename": "atomic-habits.pdf",
  "fileSizeBytes": 8123456,
  "title": "Atomic Habits"          // optional; if present it wins and the LLM identify step is skipped
}

// 201 -> BookDto
```

Server-side on `POST /books`:

1. `s3Key` must start with `books/{req.user.id}/` (`s3_key_mismatch`, 422).
2. S3 `HEAD` the object - must exist (`upload_not_found`, 422) and `ContentLength` must equal `fileSizeBytes` (`file_size_mismatch`, 422).
3. Insert the `books` row: `status = 'pending'`, `title` = the override or `null`, `original_filename`, `s3_key`, `file_size_bytes`.
4. Enqueue the BullMQ ingest job (`queue 'ingest'`, `jobId = bookId`, `data = { bookId, requestId }`).
5. Return `201` with the `BookDto`.

### `BookDto` (full - returned by create / patch / retry)

```json
{
  "id": "uuid",
  "title": "Atomic Habits",
  "author": "James Clear",
  "originalFilename": "atomic-habits.pdf",
  "fileSizeBytes": 8123456,
  "pageCount": 320,
  "status": "ready",
  "failedStage": null,
  "failureReason": null,
  "summaryGeneratedAt": "2026-08-31T10:14:00.000Z",
  "createdAt": "2026-08-31T10:00:00.000Z",
  "updatedAt": "2026-08-31T10:14:00.000Z"
}
```

`status` is one of `pending | extracting | chunking | embedding | summarizing | ready | failed | deleting` (display state only - see [Data model & schema](https://github.com/Cal3574/scriptorium/issues/3)).

### `BookListItemDto` (`GET /books`)

Same fields as `BookDto` **minus** `updatedAt` - a lightweight list row. No `summary`, no `chapters`.

### `BookDetailDto` (`GET /books/:id`)

`BookDto` plus:

```json
{
  "summary": "## Overview\n\n...markdown...",
  "chapters": [
    {
      "id": "uuid",
      "chapterIndex": 0,
      "title": "The Fundamentals",
      "pageStart": 1,
      "pageEnd": 24,
      "summary": "## Chapter 1 deep dive\n\n...markdown...",
      "createdAt": "2026-08-31T10:05:00.000Z"
    }
  ]
}
```

- `summary` is `null` until the book-summary stage completes; each `chapters[].summary` is `null` until that chapter's deep-dive completes. The client renders per-chapter loading state from those nulls plus the live SSE feed.
- `chapters` is ordered by `chapterIndex`. Never includes chunk rows.

### `UpdateBookRequest` (`PATCH /books/:id`)

```jsonc
{ "title": "Atomic Habits", "author": null }
```

- Both fields optional; **at least one** key must be present (`no_fields`, 422).
- `title`: non-empty, `<= 500` chars, **not** nullable.
- `author`: `<= 500` chars **or** `null` (explicit `null` clears a wrong LLM guess).
- Allowed in **any** `status`.
- A user-set `title` satisfies the ingest pipeline's `identifyBook` completeness check (`books.title is not null`), so the LLM identify step is skipped if it has not run yet. A user-set `author` is likewise never overwritten by the LLM.

### Retry (`POST /books/:id/retry`)

- Valid only when `status = 'failed'`, else `409` (`book_not_failed`).
- Sets `status = 'pending'`, clears `failed_stage` and `failure_reason`, re-enqueues the ingest job (`jobId = bookId`). Derive-from-data checks skip completed stages.
- Returns `200` + `BookDto`.

### Delete (`DELETE /books/:id`)

- Sets `status = 'deleting'`, enqueues the delete job on the `ingest` queue, returns `202` with an empty body.
- Deleting a book already in `deleting` is a no-op that still returns `202`.
- Full delete-job behaviour: [Data model & schema](https://github.com/Cal3574/scriptorium/issues/3) and [Ingest job spec](https://github.com/Cal3574/scriptorium/issues/8).

### SSE progress (`GET /books/:id/events`)

- Public route; `?token=<clerk jwt>` verified once at connect, then ownership-checked (`404` if the book is not the caller's).
- Response is `text/event-stream`; the event contract (`snapshot` / `stage_entered` / `stage_progress` / `book_identified` / `book_completed` / `book_failed` / `book_deleted`, `seq` ordering, 15s keep-alive) is owned by [Ingest job spec](https://github.com/Cal3574/scriptorium/issues/8).

### RAG query (`POST /queries`)

```jsonc
// CreateQueryRequest
{
  "question": "How do the habit-formation models in these books relate?",
  "bookId": "uuid"        // optional; restrict retrieval to one book. Ownership-checked -> 404
}
// Header: Accept: text/event-stream
```

- `question`: 1-2000 chars (`question_too_long` -> 422 above 2000).
- Response is an SSE stream over the POST response body, read on the client with `fetch()` + a `ReadableStream` reader (the pattern used by the Anthropic / Vercel AI SDKs) - **not** `EventSource`. This keeps the call under the global auth guard with a normal `Authorization` header and JSON body.
- The `queries` row is inserted with `answer = null` before streaming begins, so the client has the `id` from the first event.

Event sequence (each a Zod-typed schema in `@scriptorium/contracts`):

| Event | Data | When |
|---|---|---|
| `query_started` | `{ "id": "uuid" }` | row inserted, before retrieval |
| `citations` | `{ "citations": [{ "bookId", "bookTitle", "chapterTitle", "chunkId", "chunkText" }] }` | after retrieval, before synthesis - client renders sources immediately |
| `text_delta` | `{ "text": "..." }` | repeated, the answer markdown streaming in |
| `done` | `{ "answer": "...full markdown..." }` | synthesis complete; server writes `answer` + `citations` to the row here |
| `error` | `{ "message": "..." }` | synthesis failed (`upstream_failure`); row keeps `answer = null`, client offers retry |

- **Client disconnect mid-stream:** the server aborts the Claude call and leaves `answer = null`. There is no resume-a-query feature.

### `QueryListItemDto` (`GET /queries`)

```json
{
  "id": "uuid",
  "question": "How do the habit-formation models in these books relate?",
  "bookId": "uuid",
  "createdAt": "2026-08-31T10:20:00.000Z"
}
```

`answer` body omitted from the list. `bookId` may be `null` (cross-book query, or the filtered book was later deleted - `ON DELETE SET NULL`).

### `QueryDetailDto` (`GET /queries/:id`)

```json
{
  "id": "uuid",
  "question": "How do the habit-formation models in these books relate?",
  "answer": "## Synthesis\n\n...markdown...",
  "bookId": "uuid",
  "citations": [
    { "bookTitle": "Atomic Habits", "chapterTitle": "The Fundamentals", "chunkText": "...", "chunkId": "uuid" }
  ],
  "createdAt": "2026-08-31T10:20:00.000Z"
}
```

- `answer` is `null` if synthesis failed.
- `citations` is the **self-contained jsonb snapshot** from the row (display text, not live foreign keys) - it still renders after a cited book is deleted (per [Data model & schema](https://github.com/Cal3574/scriptorium/issues/3)).

## Endpoint <-> screen map

| Client screen | Endpoints |
|---|---|
| Auth | Clerk components only; `GET /me` on first authenticated load |
| Library (list / add / delete) | `GET /books`, `DELETE /books/:id`, `POST /books/:id/retry` |
| Upload (+ live progress) | `POST /books/upload-url`, PUT to S3, `POST /books`, `GET /books/:id/events` |
| Book detail | `GET /books/:id`, `PATCH /books/:id`, `GET /books/:id/events` (while not `ready`) |
| Query | `POST /queries`, `GET /queries`, `GET /queries/:id` |

## Not included in the MVP

- No `GET /books/:id/chapters` - chapters are embedded in the book detail response.
- No standalone "regenerate summary" endpoint - the only recovery path is `retry` (for `failed` books) or delete + re-upload.
- No `PATCH`/`DELETE` on queries - history is read-only.
- No pagination, filtering, or sorting query params.
- No API-key or machine-to-machine auth - Clerk user tokens only.
