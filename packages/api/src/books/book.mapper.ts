import {
  BookDetailDto,
  BookDto,
  BookListItemDto,
  ChapterDto,
} from '@scriptorium/contracts';
import type { BookRow, ChapterRow } from '@scriptorium/server-core';

// The one place a raw `books` row becomes a wire DTO. Storage-only columns
// (`s3Key`, `extractedMarkdownKey`, `userId`) are dropped by omission, and the
// `timestamptz` columns are encoded as ISO strings.
function toBookShape(row: BookRow) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    originalFilename: row.originalFilename,
    fileSizeBytes: row.fileSizeBytes,
    pageCount: row.pageCount,
    status: row.status,
    failedStage: row.failedStage,
    failureReason: row.failureReason,
    summaryGeneratedAt: row.summaryGeneratedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toBookDto(row: BookRow): BookDto {
  return BookDto.parse(toBookShape(row));
}

export function toBookListItemDto(row: BookRow): BookListItemDto {
  return BookListItemDto.parse(toBookShape(row));
}

// One `chapters` row to its wire shape. `bookId` and `updatedAt` are dropped
// by omission; chunk rows never reach here.
function toChapterShape(row: ChapterRow) {
  return {
    id: row.id,
    chapterIndex: row.chapterIndex,
    title: row.title,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toChapterDto(row: ChapterRow): ChapterDto {
  return ChapterDto.parse(toChapterShape(row));
}

// `GET /api/v1/books/:id`: the book row plus its whole-book `summary` and its
// chapters, already ordered by `chapterIndex` by the repository.
export function toBookDetailDto(
  row: BookRow,
  chapterRows: ChapterRow[],
): BookDetailDto {
  return BookDetailDto.parse({
    ...toBookShape(row),
    summary: row.summary,
    chapters: chapterRows.map(toChapterShape),
  });
}
