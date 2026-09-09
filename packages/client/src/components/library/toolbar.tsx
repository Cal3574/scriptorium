import type { BookListItemDto } from '@scriptorium/contracts';

import { statusRole } from '@/books/status';
import type { LimitCode } from '@/books/problem';
import { DepositSlot } from './deposit-slot';
import type { useApi } from '@/auth/use-api';

type ApiFetch = ReturnType<typeof useApi>;

// `6 books · 1 working · 1 failed` - the books count is always shown; the
// working / failed segments only when non-zero.
function summarise(books: BookListItemDto[]): string {
  let working = 0;
  let failed = 0;
  for (const book of books) {
    const role = statusRole(book.status);
    if (role === 'working') working += 1;
    if (role === 'failed') failed += 1;
  }
  const parts = [`${books.length} ${books.length === 1 ? 'book' : 'books'}`];
  if (working) parts.push(`${working} working`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(' · ');
}

// The bar above the list (#54): screen name, a mono summary of the current
// list's status, and the primary upload action. Plan-limit standing lives on
// the `/activity` screen now, not here. Panel background with the one ambient
// shadow.
export function Toolbar({
  books,
  api,
  onUploaded,
  onLimitReached,
}: {
  books: BookListItemDto[];
  api: ApiFetch;
  onUploaded: () => void;
  onLimitReached: (code: LimitCode) => void;
}) {
  return (
    <div className="border-border bg-card mb-4 flex items-center gap-4 rounded-lg border px-4 py-3 shadow-xs">
      <h1 className="text-foreground m-0 text-sm font-semibold">Library</h1>
      <span className="text-muted-foreground font-mono text-xs">
        {summarise(books)}
      </span>
      <div className="ml-auto">
        <DepositSlot
          api={api}
          books={books}
          onUploaded={onUploaded}
          onLimitReached={onLimitReached}
        />
      </div>
    </div>
  );
}
