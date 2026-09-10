import type { BookListItemDto } from '@scriptorium/contracts';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { sortBooks } from '@/books/sort-books';
import { BookRow, GRID_COLS, ROW_GRID } from './book-row';

const MICRO_LABEL =
  'text-muted-foreground font-mono text-[10px] font-medium uppercase tracking-[0.08em]';

// The column header: the dense-worklist device. Hidden below `sm`, where each
// row is a self-labelling stacked card instead.
const HEADER = cn(
  'hidden border-border border-b sm:grid sm:h-9 sm:items-center sm:gap-x-3 sm:px-4',
  GRID_COLS,
);

function Header() {
  return (
    <div className={HEADER}>
      <span className="sr-only">Cover</span>
      <span className={MICRO_LABEL}>Book</span>
      <span className={MICRO_LABEL}>Status</span>
      <span className={MICRO_LABEL}>Progress</span>
      <span className="sr-only">Actions</span>
    </div>
  );
}

// The bordered list panel (#54). From `sm` up it is a dense four-column
// worklist that scrolls horizontally if the viewport is still too narrow;
// below `sm` the grid is dropped entirely and each book is a stacked card.
export function LibraryTable({
  books,
  onSettled,
}: {
  books: BookListItemDto[];
  onSettled: () => void;
}) {
  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border sm:overflow-x-auto">
      <div className="sm:min-w-[38rem]">
        <Header />
        {sortBooks(books).map((book) => (
          <BookRow key={book.id} book={book} onSettled={onSettled} />
        ))}
      </div>
    </div>
  );
}

// The loading placeholder: the same panel and header over a handful of
// skeleton rows, so the list does not flash empty then full (#63).
export function LibraryTableSkeleton() {
  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border sm:overflow-x-auto">
      <div className="sm:min-w-[38rem]">
        <Header />
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'border-border flex flex-col gap-2 border-b px-4 py-3 last:border-b-0',
              ROW_GRID,
            )}
          >
            <div className="flex gap-3 sm:contents">
              <Skeleton className="aspect-[3/4] w-10 rounded-[3px] sm:w-11" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="flex gap-3 sm:contents">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
            <span className="hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
