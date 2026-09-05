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

// The library worklist plus the upload control. One screen: uploading a book
// and seeing it land as `pending` are the same user moment. Opening a book is
// a router link to `/books/:bookId`, not a callback. The per-row SSE
// subscription and every API call are unchanged from the pre-restyle screen
// (#63) - only the markup moved to the Console visual direction.
export function Library() {
  const api = useApi();
  const [books, setBooks] = useState<BookListItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await api('/api/v1/books');
    if (!res.ok) throw new Error(`library failed: ${res.status}`);
    setBooks((await res.json()) as BookListItemDto[]);
  }, [api]);

  useEffect(() => {
    refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  const onSettled = useCallback(() => {
    refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  return (
    <section>
      <Toolbar books={books ?? []} api={api} onUploaded={onSettled} />

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
