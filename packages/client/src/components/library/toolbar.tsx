import { Fragment } from 'react';
import { Grid2X2Icon, ListIcon } from 'lucide-react';
import type { BookListItemDto } from '@scriptorium/contracts';

import { Button } from '@/components/ui/button';
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
  view,
  onViewChange,
  onUploaded,
  onLimitReached,
}: {
  books: BookListItemDto[];
  api: ApiFetch;
  view: 'grid' | 'list';
  onViewChange: (view: 'grid' | 'list') => void;
  onUploaded: () => void;
  onLimitReached: (code: LimitCode) => void;
}) {
  const segments = summariseBooks(books);

  return (
    <div className="premium-panel mb-5 flex flex-col gap-4 rounded-xl px-4 py-4 sm:flex-row sm:items-center">
      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">
          Collection
        </p>
        <h1 className="text-foreground m-0 font-serif text-2xl font-semibold">
          Library
        </h1>
      </div>
      <span className="text-muted-foreground font-mono text-xs tabular-nums sm:ml-2">
        {segments.map((segment, i) => (
          <Fragment key={segment.label}>
            {i > 0 && <span className="text-border"> · </span>}
            <span className={cn(segment.role && ROLE_COLOR[segment.role])}>
              {segment.label}
            </span>
          </Fragment>
        ))}
      </span>
      <div className="flex items-center gap-2 sm:ml-auto">
        <div
          className="flex rounded-lg border border-border/80 bg-background/35 p-1"
          aria-label="Library view"
        >
          <Button
            type="button"
            size="icon-xs"
            variant={view === 'grid' ? 'premium' : 'ghost'}
            aria-label="Show library as grid"
            aria-pressed={view === 'grid'}
            onClick={() => onViewChange('grid')}
          >
            <Grid2X2Icon />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant={view === 'list' ? 'premium' : 'ghost'}
            aria-label="Show library as list"
            aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}
          >
            <ListIcon />
          </Button>
        </div>
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
