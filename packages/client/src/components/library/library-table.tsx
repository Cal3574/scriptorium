import type { BookListItemDto } from '@scriptorium/contracts';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { BookRow, ROW_GRID } from './book-row';

const MICRO_LABEL =
  'text-muted-foreground font-mono text-[10px] font-medium uppercase tracking-[0.08em]';

// The bordered list panel (#54): a mono uppercase column-header row over the
// dense ~44px book rows. Horizontally scrolls on narrow screens so the row
// grid never squashes.
export function LibraryTable({
  books,
  onSettled,
}: {
  books: BookListItemDto[];
  onSettled: () => void;
}) {
  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <div className="min-w-[36rem]">
        <div
          className={cn(ROW_GRID, 'border-border h-9 items-center border-b')}
        >
          <span className={MICRO_LABEL}>Book</span>
          <span className={MICRO_LABEL}>Status</span>
          <span className={MICRO_LABEL}>Progress</span>
          <span className="sr-only">Actions</span>
        </div>
        {books.map((book) => (
          <BookRow key={book.id} book={book} onSettled={onSettled} />
        ))}
      </div>
    </div>
  );
}

// The loading placeholder: the same panel and column header over a handful of
// skeleton rows, so the list does not flash empty then full (#63).
export function LibraryTableSkeleton() {
  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      <div className="min-w-[36rem]">
        <div
          className={cn(ROW_GRID, 'border-border h-9 items-center border-b')}
        >
          <span className={MICRO_LABEL}>Book</span>
          <span className={MICRO_LABEL}>Status</span>
          <span className={MICRO_LABEL}>Progress</span>
          <span className="sr-only">Actions</span>
        </div>
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
            <Skeleton className="h-4 w-24" />
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}
