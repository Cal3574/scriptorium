import { BookDto, BookListItemDto } from '@scriptorium/contracts';
import type { BookRow } from '@scriptorium/server-core';

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
