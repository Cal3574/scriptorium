import { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import type {
  BookDetailDto,
  BookDto,
  ChapterDto,
} from '@scriptorium/contracts';
import { useApi } from '../auth/use-api';
import { MUTED, problemMessage } from './problem';
import { failureHeadline, friendlyFailureLabel } from './failure';
import { useIngestEvents } from './use-ingest-events';

const TERMINAL: ReadonlySet<string> = new Set(['ready', 'failed']);

// The Book-detail screen: the whole-book summary rendered as markdown, every
// chapter in `chapterIndex` order with its deep-dive behind an expand/collapse,
// and inline correction of a wrong title or author wired to `PATCH /books/:id`.
// A null summary (book or chapter) shows a muted "Not generated yet" state.
export function BookDetail({
  bookId,
  onBack,
}: {
  bookId: string;
  onBack: () => void;
}) {
  const api = useApi();
  const [book, setBook] = useState<BookDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api(`/api/v1/books/${bookId}`);
    if (!res.ok) {
      throw new Error(
        (await problemMessage(res)) ?? `load failed: ${res.status}`,
      );
    }
    setBook((await res.json()) as BookDetailDto);
  }, [api, bookId]);

  useEffect(() => {
    setBook(null);
    setError(null);
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  // While the book is mid-pipeline (including straight after a retry) follow
  // the live progress stream; when it settles, refetch the detail so the
  // summaries and any new failure state land.
  const live = book != null && !TERMINAL.has(book.status);
  const { progress, connected } = useIngestEvents(bookId, live);

  useEffect(() => {
    if (live && progress && TERMINAL.has(progress.status)) {
      load().catch((err: Error) => setError(err.message));
    }
  }, [live, progress, load]);

  const retry = useCallback(async () => {
    const res = await api(`/api/v1/books/${bookId}/retry`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(
        (await problemMessage(res)) ?? `retry failed: ${res.status}`,
      );
    }
    // Book is `pending` again; reload drops the banner and the effect above
    // re-subscribes to the live stream. Never auto-retried.
    await load();
  }, [api, bookId, load]);

  // One PATCH key at a time - the screen only ever edits a single field. The
  // body carries exactly that key, so `author: null` (a clear) is sent as
  // such while an untouched field is never mentioned.
  const patch = useCallback(
    async (body: { title: string } | { author: string | null }) => {
      const res = await api(`/api/v1/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(
          (await problemMessage(res)) ?? `update failed: ${res.status}`,
        );
      }
      const updated = (await res.json()) as BookDto;
      setBook((prev) =>
        prev ? { ...prev, title: updated.title, author: updated.author } : prev,
      );
    },
    [api, bookId],
  );

  if (error) {
    return (
      <section>
        <BackButton onBack={onBack} />
        <p role="alert">{error}</p>
      </section>
    );
  }
  if (!book) {
    return (
      <section>
        <BackButton onBack={onBack} />
        <p>Loading book...</p>
      </section>
    );
  }

  const displayTitle = book.title ?? book.originalFilename;

  return (
    <section>
      <BackButton onBack={onBack} />
      <h2>{displayTitle}</h2>

      {book.status === 'failed' && <FailedBanner book={book} onRetry={retry} />}
      {live && (
        <p role="status" data-connected={connected}>
          Processing:{' '}
          {progress?.stage
            ? `${progress.stage}${
                progress.progress
                  ? ` ${progress.progress.done}/${progress.progress.total} ${progress.progress.unit}`
                  : ''
              }`
            : 'starting...'}
        </p>
      )}

      <dl>
        <dt>Title</dt>
        <dd>
          <EditableField
            label="title"
            value={book.title}
            placeholder={book.originalFilename}
            nullable={false}
            onSave={(next) => patch({ title: next as string })}
          />
        </dd>
        <dt>Author</dt>
        <dd>
          <EditableField
            label="author"
            value={book.author}
            placeholder="Unknown author"
            nullable
            onSave={(next) => patch({ author: next })}
          />
        </dd>
      </dl>

      <h3>Summary</h3>
      {book.summary ? <Markdown>{book.summary}</Markdown> : <NotGeneratedYet />}

      <h3>Chapters</h3>
      {book.chapters.length === 0 ? (
        <NotGeneratedYet />
      ) : (
        <ol>
          {book.chapters.map((chapter) => (
            <ChapterItem key={chapter.id} chapter={chapter} />
          ))}
        </ol>
      )}
    </section>
  );
}

function ChapterItem({ chapter }: { chapter: ChapterDto }) {
  const heading = chapter.title ?? `Chapter ${chapter.chapterIndex + 1}`;
  return (
    <li>
      <details>
        <summary>{heading}</summary>
        {chapter.summary ? (
          <Markdown>{chapter.summary}</Markdown>
        ) : (
          <NotGeneratedYet />
        )}
      </details>
    </li>
  );
}

// The top-of-screen banner for a failed book. The book stays fully readable
// below it; this only explains the stall in plain language, exposes the raw
// `failureReason` behind a toggle, and offers a one-click Retry.
function FailedBanner({
  book,
  onRetry,
}: {
  book: BookDetailDto;
  onRetry: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onRetry();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alert" data-failed-banner>
      <p>
        <strong>{failureHeadline(book.failedStage)}</strong> Everything we
        finished before it stopped is shown below.
      </p>
      {book.failureReason && (
        <details>
          <summary>Show details</summary>
          <p style={{ color: MUTED }}>{book.failureReason}</p>
        </details>
      )}
      <button type="button" onClick={() => void run()} disabled={busy}>
        {busy
          ? 'Retrying...'
          : `Retry ${friendlyFailureLabel(book.failedStage)}`}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function NotGeneratedYet() {
  return <p style={{ color: MUTED }}>Not generated yet</p>;
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack}>
      &larr; Back to library
    </button>
  );
}

// Inline edit for one field. Shows the current value (or a muted placeholder
// when empty) with an Edit control; editing swaps in a text input with
// Save/Cancel. A `nullable` field saved empty sends an explicit `null`; a
// non-nullable field (title) refuses an empty save.
function EditableField({
  label,
  value,
  placeholder,
  nullable,
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  nullable: boolean;
  onSave: (next: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDraft(value ?? '');
    setError(null);
    setEditing(true);
  }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed && !nullable) {
      setError('A title is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed ? trimmed : null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span>
        {value ? (
          <span>{value}</span>
        ) : (
          <span style={{ color: MUTED }}>{placeholder}</span>
        )}{' '}
        <button type="button" onClick={start} aria-label={`Edit ${label}`}>
          Edit
        </button>
      </span>
    );
  }

  return (
    <span>
      <input
        type="text"
        value={draft}
        disabled={busy}
        aria-label={`${label} input`}
        onChange={(e) => setDraft(e.target.value)}
      />{' '}
      <button type="button" onClick={() => void save()} disabled={busy}>
        {busy ? 'Saving...' : 'Save'}
      </button>{' '}
      <button type="button" onClick={() => setEditing(false)} disabled={busy}>
        Cancel
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
