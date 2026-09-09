import { Fragment } from 'react';
import type { BookListItemDto } from '@scriptorium/contracts';

import { cn } from '@/lib/utils';
import type { LimitCode } from '@/books/problem';
import { DepositSlot } from './deposit-slot';
import { summariseBooks } from './summary';
import type { useApi } from '@/auth/use-api';

type ApiFetch = ReturnType<typeof useApi>;

const ROLE_COLOR = {
  working: 'text-status-progress',
  failed: 'text-status-failed',
} as const;

// The bar above the list (#54): screen name, a mono summary of the current
// list's status - the `working` / `failed` figures tinted with their status
// colour (#52) - and the primary upload action. Plan-limit standing lives on
// the `/activity` screen now, not here.
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
  const segments = summariseBooks(books);

  return (
    <div className="border-border bg-card mb-4 flex items-center gap-4 rounded-lg border px-4 py-3 shadow-xs">
      <h1 className="text-foreground m-0 text-sm font-semibold">Library</h1>
      <span className="text-muted-foreground font-mono text-xs tabular-nums">
        {segments.map((segment, i) => (
          <Fragment key={segment.label}>
            {i > 0 && <span className="text-border"> · </span>}
            <span className={cn(segment.role && ROLE_COLOR[segment.role])}>
              {segment.label}
            </span>
          </Fragment>
        ))}
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
