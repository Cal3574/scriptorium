import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type {
  BookListItemDto,
  CreateUploadUrlResponse,
} from '@scriptorium/contracts';
import { useApi } from '../auth/use-api';
import { useIngestEvents } from './use-ingest-events';
import { problemMessage, MUTED } from './problem';
import { failureHeadline } from './failure';

const TERMINAL: ReadonlySet<string> = new Set(['ready', 'failed']);

const PDF_CONTENT_TYPE = 'application/pdf';

// The library list plus the upload control. One screen: uploading a book and
// seeing it land as `pending` are the same user moment. Opening a book is a
// router link to `/books/:bookId`, not a callback.
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

  return (
    <section>
      <h2>Library</h2>
      <UploadForm
        api={api}
        onUploaded={() => refresh().catch((e: Error) => setError(e.message))}
      />
      {error && <p role="alert">{error}</p>}
      {!books ? (
        <p>Loading your library...</p>
      ) : books.length === 0 ? (
        <p>No books yet. Upload a PDF to get started.</p>
      ) : (
        <ul>
          {books.map((book) => (
            <BookRow
              key={book.id}
              book={book}
              onSettled={() =>
                refresh().catch((e: Error) => setError(e.message))
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// One library row. While the book is not in a terminal state it subscribes to
// the SSE progress stream and shows the live stage; a reload picks the stream
// back up from the snapshot with nothing missed or repeated. When the stream
// reports a terminal state it asks the list to refetch the canonical row.
function BookRow({
  book,
  onSettled,
}: {
  book: BookListItemDto;
  onSettled: () => void;
}) {
  const api = useApi();
  const live = !TERMINAL.has(book.status);
  const { progress, connected, deleted } = useIngestEvents(book.id, live);
  const settledRef = useRef(false);

  const status = progress?.status ?? book.status;
  const title = progress?.title ?? book.title ?? book.originalFilename;
  const deleting = status === 'deleting';

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const failed = status === 'failed';
  const failedStage = progress?.failedStage ?? book.failedStage;

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
    <li>
      <Link to={`/books/${book.id}`}>{title}</Link>{' '}
      <span data-status={status}>({status})</span>
      {failed ? (
        <span data-failed style={{ color: MUTED }}>
          {' '}
          - {failureHeadline(failedStage)}
        </span>
      ) : (
        live &&
        status !== 'pending' &&
        !deleting && (
          <LiveProgress
            stage={progress?.stage ?? null}
            progress={progress?.progress ?? null}
            connected={connected}
          />
        )
      )}
      {failed && (
        <>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
            aria-label={`Retry ${title}`}
          >
            {retrying ? 'Retrying...' : 'Retry'}
          </button>
          {(progress?.failureReason ?? book.failureReason) && (
            <details>
              <summary>Show details</summary>
              <p style={{ color: MUTED }}>
                {progress?.failureReason ?? book.failureReason}
              </p>
            </details>
          )}
        </>
      )}
      <button
        type="button"
        onClick={() => void remove()}
        disabled={deleting}
        aria-label={`Delete ${title}`}
      >
        {deleting ? 'Deleting...' : 'Delete'}
      </button>
      {deleteError && <span role="alert">{deleteError}</span>}
      {retryError && <span role="alert">{retryError}</span>}
    </li>
  );
}

function LiveProgress({
  stage,
  progress,
  connected,
}: {
  stage: string | null;
  progress: { done: number; total: number; unit: string } | null;
  connected: boolean;
}) {
  return (
    <span role="status" data-live-progress data-connected={connected}>
      {stage ? ` - ${stage}` : ''}
      {progress ? ` ${progress.done}/${progress.total} ${progress.unit}` : ''}
    </span>
  );
}

type ApiFetch = ReturnType<typeof useApi>;

function UploadForm({
  api,
  onUploaded,
}: {
  api: ApiFetch;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Ask the API for a presigned PUT pinned to a key it chooses.
      const urlRes = await api('/api/v1/books/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || PDF_CONTENT_TYPE,
          fileSizeBytes: file.size,
        }),
      });
      if (!urlRes.ok) {
        throw new Error((await problemMessage(urlRes)) ?? 'upload-url failed');
      }
      const { uploadUrl, s3Key } =
        (await urlRes.json()) as CreateUploadUrlResponse;

      // 2. PUT the bytes straight to S3 - never through the API.
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': PDF_CONTENT_TYPE },
        body: file,
      });
      if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);

      // 3. Register the book; the API verifies the object and enqueues ingest.
      const createRes = await api('/api/v1/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          s3Key,
          originalFilename: file.name,
          fileSizeBytes: file.size,
        }),
      });
      if (!createRes.ok) {
        throw new Error((await problemMessage(createRes)) ?? 'create failed');
      }

      setFile(null);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void upload();
      }}
    >
      <input
        type="file"
        accept={PDF_CONTENT_TYPE}
        disabled={busy}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button type="submit" disabled={!file || busy}>
        {busy ? 'Uploading...' : 'Upload'}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
