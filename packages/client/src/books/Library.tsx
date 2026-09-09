import { useCallback, useEffect, useState } from 'react';
import { LibraryBigIcon } from 'lucide-react';
import type { BookListItemDto } from '@scriptorium/contracts';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { EmptyState } from '@/components/empty-state';
import { Toolbar } from '@/components/library/toolbar';
import {
  LibraryTable,
  LibraryTableSkeleton,
} from '@/components/library/library-table';
import { useApi } from '../auth/use-api';
import { useUsage } from '../usage/use-usage';
import type { LimitCode } from './problem';
import { LimitReachedNotice } from '../usage/limit-reached-notice';

// The library worklist plus the upload control. One screen: uploading a book
// and seeing it land as `pending` are the same user moment. Opening a book is
// a router link to `/books/:bookId`, not a callback. The per-row SSE
// subscription and every API call are unchanged from the pre-restyle screen
// (#63) - only the markup moved to the Console visual direction.
export function Library() {
  const api = useApi();
  const { refetch: refetchUsage } = useUsage();
  const [books, setBooks] = useState<BookListItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookLimit, setBookLimit] = useState<LimitCode | null>(null);

  const refresh = useCallback(async () => {
    const res = await api('/api/v1/books');
    if (!res.ok) throw new Error(`library failed: ${res.status}`);
    setBooks((await res.json()) as BookListItemDto[]);
  }, [api]);

  // Keep the ambient usage context (the 402 payment-required handler) current
  // on library mount, even though the visible meter now lives on `/activity`.
  useEffect(() => {
    void refetchUsage();
  }, [refetchUsage]);

  useEffect(() => {
    refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  // A book row settling (ingest finished) only changes the list, not the
  // counts - the book was counted at upload.
  const onSettled = useCallback(() => {
    refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  // A successful upload adds a book row: refresh the list and the meter, and
  // clear any stale limit notice from a previous attempt.
  const onUploaded = useCallback(() => {
    setBookLimit(null);
    onSettled();
    void refetchUsage();
  }, [onSettled, refetchUsage]);

  // `POST /books` came back 402: the book quota is spent. Show the inline
  // notice where the library-load error would sit, and refetch the meter so
  // its numbers match (the 402 also pinged the usage bus via `useApi`, but the
  // call site refetching is the contract).
  const onLimitReached = useCallback(
    (code: LimitCode) => {
      setBookLimit(code);
      void refetchUsage();
    },
    [refetchUsage],
  );

  return (
    <section>
      <Toolbar
        books={books ?? []}
        api={api}
        onUploaded={onUploaded}
        onLimitReached={onLimitReached}
      />

      {bookLimit && <LimitReachedNotice code={bookLimit} />}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Couldn&apos;t load your library</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!books ? (
        <LibraryTableSkeleton />
      ) : books.length === 0 ? (
        <EmptyState
          icon={LibraryBigIcon}
          title="No books yet"
          body="Upload a PDF with the button above and it will appear here as it processes."
        />
      ) : (
        <LibraryTable books={books} onSettled={onSettled} />
      )}
    </section>
  );
}
