import type { BookListItemDto } from '@scriptorium/contracts';

import { summariseBooks } from './summary';

function book(status: BookListItemDto['status']): BookListItemDto {
  return { id: status + Math.random(), status } as BookListItemDto;
}

describe('summariseBooks', () => {
  it('always leads with the total, pluralised', () => {
    expect(summariseBooks([]).map((s) => s.label)).toEqual(['0 books']);
    expect(summariseBooks([book('ready')]).map((s) => s.label)).toEqual([
      '1 book',
    ]);
  });

  it('adds working and failed segments only when non-zero, tagged with a role', () => {
    const segments = summariseBooks([
      book('ready'),
      book('embedding'),
      book('chunking'),
      book('failed'),
      book('failed'),
    ]);
    expect(segments).toEqual([
      { label: '5 books' },
      { label: '2 working', role: 'working' },
      { label: '2 failed', role: 'failed' },
    ]);
  });

  it('counts every in-flight status as working', () => {
    const working = summariseBooks([
      book('extracting'),
      book('chunking'),
      book('summarizing'),
    ]).find((s) => s.role === 'working');
    expect(working?.label).toBe('3 working');
  });
});
