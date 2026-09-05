import type { QueryListItemDto } from '@scriptorium/contracts';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { HistoryRow, ROW_GRID } from './history-row';

const MICRO_LABEL =
  'text-muted-foreground font-mono text-[10px] font-medium uppercase tracking-[0.08em]';

function HeaderRow() {
  return (
    <div className={cn(ROW_GRID, 'border-border h-9 items-center border-b')}>
      <span className={MICRO_LABEL}>Question</span>
      <span className={MICRO_LABEL}>Asked</span>
      <span className="sr-only">Status</span>
    </div>
  );
}

// The bordered list panel (#54): a mono uppercase column-header row over the
// dense history rows, newest first as the server returns them. Horizontally
// scrolls on narrow screens so the row grid never squashes.
export function HistoryList({ items }: { items: QueryListItemDto[] }) {
  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <div className="min-w-[32rem]">
        <HeaderRow />
        {items.map((item) => (
          <HistoryRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

// The loading placeholder: the same panel and column header over a handful of
// skeleton rows, so the list does not flash empty then full (#67).
export function HistoryListSkeleton() {
  return (
    <div
      className="border-border bg-card overflow-x-auto rounded-lg border"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Loading your questions</span>
      <div className="min-w-[32rem]">
        <HeaderRow />
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              ROW_GRID,
              'border-border border-b py-2.5 last:border-b-0',
            )}
          >
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-16" />
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}
