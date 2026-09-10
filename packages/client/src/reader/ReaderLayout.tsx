import { useEffect, useState } from 'react';
import { Navigate, Outlet, ScrollRestoration, useParams } from 'react-router';
import type { BookDetailDto } from '@scriptorium/contracts';

import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '../auth/use-api';
import { setDocumentTitle } from '../use-document-title';
import { ReaderToc } from './ReaderToc';
import type { ReaderContext } from './reader-context';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; book: BookDetailDto }
  // Book exists but is not `ready`, or the fetch failed: Book-detail is the
  // screen that shows pipeline / failure / load-error state properly.
  | { status: 'to-detail' }
  | { status: 'to-library' }; // 404 - unknown or unowned

// The reader shell (#136): loads `BookDetailDto` once, applies the redirect
// rules, and frames the Overview / chapter screens with a persistent TOC
// sidebar and a single `<ScrollRestoration>`. It never subscribes to the
// ingest stream - a `ready` book is treated as a finished artifact.
export function ReaderLayout() {
  const { bookId = '' } = useParams();
  const api = useApi();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    api(`/api/v1/books/${bookId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setState({ status: 'to-library' });
          return;
        }
        if (!res.ok) {
          setState({ status: 'to-detail' });
          return;
        }
        const book = (await res.json()) as BookDetailDto;
        if (cancelled) return;
        setState(
          book.status === 'ready'
            ? { status: 'ready', book }
            : { status: 'to-detail' },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'to-detail' });
      });

    return () => {
      cancelled = true;
    };
  }, [api, bookId]);

  useEffect(() => {
    if (state.status === 'ready' && state.book.title) {
      setDocumentTitle(state.book.title);
    }
    return () => setDocumentTitle();
  }, [state]);

  if (state.status === 'to-detail') {
    return <Navigate to={`/books/${bookId}`} replace />;
  }
  if (state.status === 'to-library') {
    return <Navigate to="/library" replace />;
  }
  if (state.status === 'loading') {
    return <ReaderSkeleton />;
  }

  return (
    <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10">
      <ReaderToc book={state.book} />
      <div className="min-w-0">
        <Outlet context={{ book: state.book } satisfies ReaderContext} />
      </div>
      <ScrollRestoration />
    </div>
  );
}

function ReaderSkeleton() {
  return (
    <div
      data-testid="reader-skeleton"
      className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10"
    >
      <div className="hidden space-y-2 md:block">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}
