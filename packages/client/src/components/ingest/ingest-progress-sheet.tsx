import type { ReactNode } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import type { BookListItemDto } from '@scriptorium/contracts';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { IngestProgress } from '@/books/use-ingest-events';
import { IngestTimeline } from './ingest-timeline';

// The library-row entry point to the ingest timeline. The row's compact
// progress cell becomes the trigger; the full step-by-step view opens in a
// right-hand sheet without leaving the worklist. Driven by the row's existing
// `useIngestEvents` subscription - nothing here opens a second stream.
export function IngestProgressSheet({
  book,
  progress,
  connected,
  onRetry,
  children,
}: {
  book: BookListItemDto;
  progress: IngestProgress | null;
  connected: boolean;
  onRetry?: () => void | Promise<void>;
  children: ReactNode;
}) {
  const title = progress?.title ?? book.title ?? book.originalFilename;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className="focus-visible:ring-ring/50 group/progress -m-1 flex w-full items-center gap-1 rounded-sm p-1 text-left outline-none focus-visible:ring-[3px]"
          aria-label={`Ingestion progress for ${title}`}
        >
          <span className="min-w-0 flex-1">{children}</span>
          <ChevronRightIcon className="text-muted-foreground size-3.5 shrink-0 transition-transform group-hover/progress:translate-x-0.5" />
        </button>
      </SheetTrigger>
      <SheetContent className="gap-5 overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="truncate">{title}</SheetTitle>
          <SheetDescription>
            Where this book is in processing, updating live.
          </SheetDescription>
        </SheetHeader>
        <IngestTimeline
          book={book}
          progress={progress}
          connected={connected}
          onRetry={onRetry}
        />
      </SheetContent>
    </Sheet>
  );
}
