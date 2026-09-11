import { useState } from 'react';
import { Link, NavLink } from 'react-router';
import { ArrowLeftIcon, ListIcon } from 'lucide-react';
import type { BookDetailDto } from '@scriptorium/contracts';

import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  chapterHeading,
  chapterOrdinal,
  pageRange,
} from '@/books/chapter-display';

// The reader's table of contents (Direction B): a persistent left sidebar on
// desktop, the same list behind a sheet below `md`. "Back to book" leaves the
// reader; "Overview" is the whole-book screen; then one row per chapter in
// order, the current one marked with the inset primary rule.
export function ReaderToc({ book }: { book: BookDetailDto }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <aside className="border-border hidden md:block md:border-r md:pr-6">
        <TocBody book={book} />
      </aside>

      <div className="mb-6 md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium">
            <ListIcon className="size-3.5" />
            Contents
          </SheetTrigger>
          <SheetContent side="left" className="overflow-y-auto">
            <TocBody book={book} onNavigate={() => setSheetOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

function TocBody({
  book,
  onNavigate,
}: {
  book: BookDetailDto;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Chapters" className="text-sm">
      <Link
        to={`/books/${book.id}`}
        onClick={onNavigate}
        className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-xs font-medium"
      >
        <ArrowLeftIcon className="size-3.5" />
        Back to book
      </Link>

      <ol className="border-border m-0 list-none border-t p-0">
        <li>
          <NavLink
            to={`/books/${book.id}/read`}
            end
            onClick={onNavigate}
            className={({ isActive }) => tocRowClass(isActive)}
          >
            <span className="text-muted-foreground font-mono text-[10px]">
              00
            </span>
            <span>Overview</span>
          </NavLink>
        </li>
        {book.chapters.map((chapter, index) => {
          const number = index + 1;
          const range = pageRange(chapter);
          return (
            <li key={chapter.id}>
              <NavLink
                to={`/books/${book.id}/read/${number}`}
                onClick={onNavigate}
                className={({ isActive }) => tocRowClass(isActive)}
              >
                <span className="text-muted-foreground font-mono text-[10px]">
                  {chapterOrdinal(number)}
                </span>
                <span className="min-w-0">
                  {chapterHeading(chapter, number)}
                </span>
                {range && (
                  <span className="text-muted-foreground font-mono text-[9.5px] whitespace-nowrap">
                    {range}
                  </span>
                )}
              </NavLink>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function tocRowClass(current: boolean): string {
  return cn(
    'grid grid-cols-[1.25rem_1fr_auto] items-baseline gap-2 px-2 py-1.5 no-underline leading-snug',
    'hover:bg-muted',
    current
      ? 'bg-accent font-medium shadow-[inset_2px_0_0_var(--primary)]'
      : 'text-foreground',
  );
}
