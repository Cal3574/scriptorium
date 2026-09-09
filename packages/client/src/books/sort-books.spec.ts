import type { BookListItemDto } from '@scriptorium/contracts';

import { sortBooks } from './sort-books';

// Minimal row factory - only the fields `sortBooks` reads.
function book(
  over: Partial<BookListItemDto> & Pick<BookListItemDto, 'id'>,
): BookListItemDto {
  return {
    id: over.id,
    title: over.title ?? 'Untitled',
    author: null,
    originalFilename: 'x.pdf',
    fileSizeBytes: null,
    pageCount: null,
    status: over.status ?? 'ready',
    failedStage: null,
    failureReason: null,
    summaryGeneratedAt: null,
    createdAt: over.createdAt ?? '2026-01-01T00:00:00.000Z',
  } as BookListItemDto;
}

describe('sortBooks', () => {
  it('floats in-flight books above failed, queued and ready ones', () => {
    const ready = book({ id: 'r', status: 'ready' });
    const working = book({ id: 'w', status: 'embedding' });
    const failed = book({ id: 'f', status: 'failed' });
    const queued = book({ id: 'q', status: 'pending' });

    expect(
      sortBooks([ready, failed, queued, working]).map((b) => b.id),
    ).toEqual(['w', 'f', 'q', 'r']);
  });

  it('orders books within the same role by newest first', () => {
    const older = book({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = book({ id: 'new', createdAt: '2026-06-01T00:00:00.000Z' });

    expect(sortBooks([older, newer]).map((b) => b.id)).toEqual(['new', 'old']);
  });

  it('sinks a deleting row to the bottom', () => {
    const deleting = book({ id: 'd', status: 'deleting' });
    const ready = book({ id: 'r', status: 'ready' });

    expect(sortBooks([deleting, ready]).map((b) => b.id)).toEqual(['r', 'd']);
  });

  it('does not mutate the input array', () => {
    const input = [book({ id: 'a' }), book({ id: 'b', status: 'pending' })];
    const copy = [...input];
    sortBooks(input);
    expect(input).toEqual(copy);
  });
});
