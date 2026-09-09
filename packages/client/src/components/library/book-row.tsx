import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { BookListItemDto } from '@scriptorium/contracts';

import { Button } from '@/components/ui/button';
import { useApi } from '@/auth/use-api';
import { useIngestEvents } from '@/books/use-ingest-events';
import { problemMessage } from '@/books/problem';
import { statusRole } from '@/books/status';
import { cn } from '@/lib/utils';
import { StatusChip } from './status-chip';
import { IngestProgressCell } from './ingest-progress-cell';
import { FailureReasonLine } from './failure-reason-line';
import { BookCover } from './book-cover';
import { IngestProgressSheet } from '@/components/ingest/ingest-progress-sheet';

const TERMINAL: ReadonlySet<string> = new Set(['ready', 'failed']);

// The four-column worklist grid, applied only from `sm` up. Below that a row
// is a stacked card (see the wrapper below) so long titles and the status /
// progress meta never fight over a squashed column on a phone.
export const GRID_COLS =
  'sm:grid-cols-[2.75rem_minmax(0,1fr)_7rem_minmax(0,12rem)_8.5rem]';
export const ROW_GRID = `sm:grid ${GRID_COLS} sm:items-start sm:gap-x-3 sm:gap-y-1 sm:px-4 sm:py-2`;

// One library row. Unchanged from the original in every respect that touches
// the network: while the book is non-terminal it subscribes to the SSE
// progress stream and shows the live stage; a reload resumes the stream from
// the snapshot with nothing missed or repeated; a terminal state asks the
// list to refetch the canonical row. Only the markup is restyled to the
// Console worklist (#63).
export function BookRow({
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
      // Back in flight (e.g. after a retry) - re-arm the settle latch.
      settledRef.current = false;
      return;
    }
    if (live && !settledRef.current) {
      settledRef.current = true;
      onSettled();
    }
  }, [live, status, onSettled]);

  // The worker finished the hard delete: the row is gone, refetch to drop it.
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
    // Show `deleting` right away; the SSE stream drops the row once the worker
    // is done.
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
      // The book is `pending` again; refetch so the row re-subscribes to the
      // live progress stream. No auto-retry - this only runs on the click.
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
    <div
      className={cn(
        'group border-border hover:bg-accent/40 flex flex-col gap-2 border-b px-4 py-3 last:border-b-0',
        ROW_GRID,
        deleting && 'pointer-events-none opacity-50',
      )}
      data-status={status}
    >
      {/* Cover + title: a flex pair on a phone, dissolved into the first two
          grid columns from `sm` up via `sm:contents`. */}
      <div className="flex gap-3 sm:contents">
        <BookCover
          id={book.id}
          title={title}
          className="w-10 self-start sm:w-11"
        />
        <span className="min-w-0">
          <Link
            to={`/books/${book.id}`}
            className="text-foreground line-clamp-2 font-serif text-[15px] leading-tight font-medium no-underline hover:underline sm:line-clamp-none"
          >
            {title}
          </Link>
          {book.author && (
            <span className="text-muted-foreground mt-0.5 block truncate text-xs">
              {book.author}
            </span>
          )}
        </span>
      </div>

      {/* Status + progress: a wrapped meta row on a phone, dissolved back into
          the grid columns from `sm` up via `sm:contents`. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:contents">
        <StatusChip status={status} />

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
          <span>{progressCell}</span>
        )}
      </div>

      <span className="flex flex-wrap gap-1 sm:justify-end sm:opacity-55 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
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
      </span>

      {failed && <FailureReasonLine reason={failureReason} />}

      {(deleteError || retryError) && (
        <span role="alert" className="text-status-failed col-span-full text-xs">
          {deleteError ?? retryError}
        </span>
      )}
    </div>
  );
}
