import { QueryDetailDto, QueryListItemDto } from '@scriptorium/contracts';
import type { QueryHistoryRow, QueryRow } from '@scriptorium/server-core';

// `GET /api/v1/queries`: the flat history row, no `answer` body. `failed` is
// `answer === null` - the query never reached `complete()`, whether from a
// mid-stream error or a client disconnect.
export function toQueryListItemDto(row: QueryHistoryRow): QueryListItemDto {
  return QueryListItemDto.parse({
    id: row.id,
    question: row.question,
    bookId: row.bookId,
    failed: row.answer === null,
    createdAt: row.createdAt.toISOString(),
  });
}

// `GET /api/v1/queries/:id`: `answer` and `citations` render whatever the row
// has - null/empty when the query failed before `complete()` ever ran.
export function toQueryDetailDto(row: QueryRow): QueryDetailDto {
  return QueryDetailDto.parse({
    id: row.id,
    question: row.question,
    answer: row.answer,
    bookId: row.bookId,
    citations: row.citations ?? [],
    createdAt: row.createdAt.toISOString(),
  });
}
