import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BookListItemDto,
  CreateUploadUrlResponse,
} from '@scriptorium/contracts';
import { useApi } from '../auth/use-api';
import { useIngestEvents } from './use-ingest-events';

const TERMINAL: ReadonlySet<string> = new Set(['ready', 'failed']);

const PDF_CONTENT_TYPE = 'application/pdf';

// The library list plus the upload control. One screen: uploading a book and
// seeing it land as `pending` are the same user moment.
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
  const live = !TERMINAL.has(book.status);
  const { progress, connected } = useIngestEvents(book.id, live);
  const settledRef = useRef(false);

  const status = progress?.status ?? book.status;
  const title = progress?.title ?? book.title ?? book.originalFilename;

  useEffect(() => {
    if (live && TERMINAL.has(status) && !settledRef.current) {
      settledRef.current = true;
      onSettled();
    }
  }, [live, status, onSettled]);

  return (
    <li>
      {title}{' '}
      <span data-status={status}>({status})</span>
      {live && status !== 'pending' && (
        <LiveProgress
          stage={progress?.stage ?? null}
          progress={progress?.progress ?? null}
          connected={connected}
          failureReason={progress?.failureReason ?? null}
        />
      )}
    </li>
  );
}

function LiveProgress({
  stage,
  progress,
  connected,
  failureReason,
}: {
  stage: string | null;
  progress: { done: number; total: number; unit: string } | null;
  connected: boolean;
  failureReason: string | null;
}) {
  if (failureReason) {
    return (
      <span role="status" data-live-progress>
        {' '}- failed: {failureReason}
      </span>
    );
  }
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

async function problemMessage(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { code?: string; detail?: string };
    return body.detail ?? body.code ?? null;
  } catch {
    return null;
  }
}
