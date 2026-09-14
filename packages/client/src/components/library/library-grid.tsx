import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { BookListItemDto } from '@scriptorium/contracts';

import { useApi } from '@/auth/use-api';
import { problemMessage } from '@/books/problem';
import { sortBooks } from '@/books/sort-books';
import { statusRole } from '@/books/status';
import { useIngestEvents } from '@/books/use-ingest-events';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BookCover } from './book-cover';
import { FailureReasonLine } from './failure-reason-line';
import { IngestProgressCell } from './ingest-progress-cell';
import { IngestProgressSheet } from '@/components/ingest/ingest-progress-sheet';
import { StatusChip } from './status-chip';

const TERMINAL: ReadonlySet<string> = new Set(['ready', 'failed']);

export function LibraryGrid({
  books,
  onSettled,
}: {
  books: BookListItemDto[];
  onSettled: () => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sortBooks(books).map((book) => (
        <LibraryGridCard key={book.id} book={book} onSettled={onSettled} />
      ))}
    </div>
  );
}

function LibraryGridCard({
  book,
  onSettled,
}: {
  book: BookListItemDto;
  onSettled: () => void;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const live = !TERMINAL.has(book.status);
  const { progress, connected, deleted } = useIngestEvents(book.id, live);
  const settledRef = useRef(false);

  const status = progress?.status ?? book.status;
  const title = progress?.title ?? book.title ?? book.originalFilename;
  const role = statusRole(status);
  const deleting = role === 'deleting';
  const failed = role === 'failed';
  const failedStage = progress?.failedStage ?? book.failedStage;
  const failureReason = progress?.failureReason ?? book.failureReason;

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    if (!TERMINAL.has(status)) {
      settledRef.current = false;
      return;
    }
    if (live && !settledRef.current) {
      settledRef.current = true;
      onSettled();
    }
  }, [live, status, onSettled]);

  useEffect(() => {
    if (deleted) onSettled();
  }, [deleted, onSettled]);

  async function remove() {
    setDeleteError(null);
    const res = await api(`/api/v1/books/${book.id}`, { method: 'DELETE' });
    if (res.status !== 202) {
      setDeleteError(
        (await problemMessage(res)) ?? `delete failed: ${res.status}`,
      );
      return;
    }
    onSettled();
  }

  async function retry() {
    setRetryError(null);
    setRetrying(true);
    try {
      const res = await api(`/api/v1/books/${book.id}/retry`, {
        method: 'POST',
      });
      if (!res.ok) {
        setRetryError(
          (await problemMessage(res)) ?? `retry failed: ${res.status}`,
        );
        return;
      }
      onSettled();
    } finally {
      setRetrying(false);
    }
  }

  const progressCell = (
    <IngestProgressCell
      role={role}
      stage={progress?.stage ?? null}
      progress={progress?.progress ?? null}
      pageCount={book.pageCount}
      chaptersTotal={progress?.chaptersTotal ?? null}
      failedStage={failedStage}
    />
  );

  return (
    <article
      data-status={status}
      className="premium-panel group relative overflow-hidden rounded-xl p-4 transition-all hover:-translate-y-0.5 hover:border-primary/45 data-[status=deleting]:pointer-events-none data-[status=deleting]:opacity-50"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-70" />
      <div className="flex gap-4">
        <BookCover
          id={book.id}
          title={title}
          className="w-20 rounded-md shadow-sm ring-white/10 transition-transform group-hover:-rotate-1 group-hover:scale-[1.02]"
        />
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-start justify-between gap-2">
            <StatusChip status={status} />
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {role}
            </span>
          </div>
          <h2 className="m-0 font-serif text-lg leading-tight font-semibold text-foreground">
            <Link
              to={`/books/${book.id}`}
              className="line-clamp-3 no-underline hover:text-primary"
            >
              {title}
            </Link>
          </h2>
          {book.author ? (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {book.author}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border/70 bg-background/35 p-3">
        {role === 'working' || role === 'queued' || failed ? (
          <IngestProgressSheet
            book={book}
            progress={progress}
            connected={connected}
            onRetry={failed ? () => void retry() : undefined}
          >
            <span
              role={role === 'working' ? 'status' : undefined}
              data-connected={role === 'working' ? connected : undefined}
            >
              {progressCell}
            </span>
          </IngestProgressSheet>
        ) : (
          progressCell
        )}
      </div>

      {failed ? <FailureReasonLine reason={failureReason} /> : null}

      <div className="mt-4 flex flex-wrap justify-end gap-1 opacity-75 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {failed ? (
          <Button
            type="button"
            size="xs"
            onClick={() => void retry()}
            disabled={retrying}
            aria-label={`Retry ${title}`}
          >
            {retrying ? 'Retrying...' : 'Retry'}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => navigate(`/books/${book.id}`)}
          >
            Open
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => void remove()}
          disabled={deleting}
          aria-label={`Delete ${title}`}
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>

      {(deleteError || retryError) && (
        <p role="alert" className="mt-2 text-xs text-status-failed">
          {deleteError ?? retryError}
        </p>
      )}
    </article>
  );
}

export function LibraryGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="premium-panel rounded-xl p-4">
          <div className="flex gap-4">
            <Skeleton className="aspect-[3/4] w-20 rounded-md" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
          <Skeleton className="mt-4 h-12 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
