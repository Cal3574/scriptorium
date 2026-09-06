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

const TERMINAL: ReadonlySet<string> = new Set(['ready', 'failed']);

// Shared grid template for the header row and every book row.
export const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_7rem_minmax(0,12rem)_8.5rem] items-start gap-x-3 gap-y-1 px-4';

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

  return (
    <div
      className={cn(
        'group border-border hover:bg-accent/40 border-b py-2 last:border-b-0',
        ROW_GRID,
        deleting && 'pointer-events-none opacity-50',
      )}
      data-status={status}
    >
      <span className="min-w-0">
        <Link
          to={`/books/${book.id}`}
          className="text-foreground font-serif text-[15px] leading-tight font-medium no-underline hover:underline"
        >
          {title}
        </Link>
        {book.author && (
          <span className="text-muted-foreground mt-0.5 block text-xs">
            {book.author}
          </span>
        )}
      </span>

      <StatusChip status={status} />

      <span
        role={role === 'working' ? 'status' : undefined}
        data-connected={role === 'working' ? connected : undefined}
      >
        <IngestProgressCell
          role={role}
          stage={progress?.stage ?? null}
          progress={progress?.progress ?? null}
          pageCount={book.pageCount}
          chaptersTotal={progress?.chaptersTotal ?? null}
          failedStage={failedStage}
        />
      </span>

      <span className="flex flex-wrap justify-end gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
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
