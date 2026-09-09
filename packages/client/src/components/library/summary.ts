import type { BookListItemDto } from '@scriptorium/contracts';

import { statusRole } from '@/books/status';

// The mono status line in the library toolbar. The total is always shown; the
// `working` / `failed` segments appear only when non-zero and carry their
// status role so the toolbar can colour the figure (#52 --status-*).
export interface SummarySegment {
  label: string;
  role?: 'working' | 'failed';
}

export function summariseBooks(books: BookListItemDto[]): SummarySegment[] {
  let working = 0;
  let failed = 0;
  for (const book of books) {
    const role = statusRole(book.status);
    if (role === 'working') working += 1;
    if (role === 'failed') failed += 1;
  }

  const segments: SummarySegment[] = [
    { label: `${books.length} ${books.length === 1 ? 'book' : 'books'}` },
  ];
  if (working) segments.push({ label: `${working} working`, role: 'working' });
  if (failed) segments.push({ label: `${failed} failed`, role: 'failed' });
  return segments;
}
