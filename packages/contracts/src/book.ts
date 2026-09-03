import { z } from 'zod';
import { isoTimestamp, uuid } from './primitives.js';

// The eight display states a book moves through. Mirrors the `book_status`
// native enum in `@scriptorium/database` - display / SSE state only, never the
// source of truth for pipeline resumption.
export const bookStatuses = [
  'pending',
  'extracting',
  'chunking',
  'embedding',
  'summarizing',
  'ready',
  'failed',
  'deleting',
] as const;
export const BookStatus = z.enum(bookStatuses);
export type BookStatus = z.infer<typeof BookStatus>;

const TITLE_MAX = 500;
const AUTHOR_MAX = 500;

// The full book resource, returned by create / patch / retry. Raw Drizzle rows
// never reach here - `s3_key`, `extracted_markdown_key` and the like are
// stripped by the API mappers.
export const BookDto = z.object({
  id: uuid,
  title: z.string().nullable(),
  author: z.string().nullable(),
  originalFilename: z.string(),
  fileSizeBytes: z.number().int().nonnegative().nullable(),
  pageCount: z.number().int().nonnegative().nullable(),
  status: BookStatus,
  failedStage: z.string().nullable(),
  failureReason: z.string().nullable(),
  summaryGeneratedAt: isoTimestamp.nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type BookDto = z.infer<typeof BookDto>;

// The lightweight library-list row: every `BookDto` field except `updatedAt`.
export const BookListItemDto = BookDto.omit({ updatedAt: true });
export type BookListItemDto = z.infer<typeof BookListItemDto>;

// One detected chapter, embedded in `BookDetailDto`. Never carries chunk rows.
export const ChapterDto = z.object({
  id: uuid,
  chapterIndex: z.number().int().nonnegative(),
  title: z.string().nullable(),
  pageStart: z.number().int().nonnegative().nullable(),
  pageEnd: z.number().int().nonnegative().nullable(),
  summary: z.string().nullable(),
  createdAt: isoTimestamp,
});
export type ChapterDto = z.infer<typeof ChapterDto>;

// `GET /api/v1/books/:id`: the full book plus its summary and ordered chapters.
// `summary` is null until the book-summary stage completes; each
// `chapters[].summary` is null until that chapter's deep-dive completes.
export const BookDetailDto = BookDto.extend({
  summary: z.string().nullable(),
  chapters: z.array(ChapterDto),
});
export type BookDetailDto = z.infer<typeof BookDetailDto>;

// --- Request bodies ---

// `POST /api/v1/books/upload-url`. The client proposes a filename and size; the
// server pins the presigned PUT to a key it chooses. `contentType` is a free
// string here so the endpoint can answer a non-PDF with the domain-specific
// `not_a_pdf` problem rather than a generic schema `422`; the same goes for an
// over-size `fileSizeBytes` and `file_too_large`.
export const CreateUploadUrlRequest = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
});
export type CreateUploadUrlRequest = z.infer<typeof CreateUploadUrlRequest>;

export const CreateUploadUrlResponse = z.object({
  uploadUrl: z.string().url(),
  s3Key: z.string().min(1),
  expiresInSeconds: z.number().int().positive(),
});
export type CreateUploadUrlResponse = z.infer<typeof CreateUploadUrlResponse>;

// `POST /api/v1/books`, sent after the client has completed the presigned PUT.
// `title`, if present, wins and the LLM identify step is skipped.
export const CreateBookRequest = z.object({
  s3Key: z.string().min(1),
  originalFilename: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
  title: z.string().min(1).max(TITLE_MAX).optional(),
});
export type CreateBookRequest = z.infer<typeof CreateBookRequest>;

// `PATCH /api/v1/books/:id` field set. `title` is non-empty and not nullable;
// an explicit `author: null` clears a wrong LLM guess. The "at least one key"
// rule is NOT expressed here so the API can validate the body against this
// schema and then answer an empty patch with the domain-specific `no_fields`
// problem rather than a generic schema `422`.
export const UpdateBookFields = z.object({
  title: z.string().min(1).max(TITLE_MAX).optional(),
  author: z.string().max(AUTHOR_MAX).nullable().optional(),
});
export type UpdateBookFields = z.infer<typeof UpdateBookFields>;

// The full `PATCH /api/v1/books/:id` contract: {@link UpdateBookFields} plus
// the "at least one key must be present" refinement.
export const UpdateBookRequest = UpdateBookFields.refine(
  (body) => Object.keys(body).length > 0,
  { message: 'At least one field must be provided' },
);
export type UpdateBookRequest = z.infer<typeof UpdateBookRequest>;
