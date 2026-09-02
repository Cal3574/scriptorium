import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { BookDetailDto, ChapterDto } from '@scriptorium/contracts';
import { useApi } from '../auth/use-api';

// The book-detail screen: the whole-book summary as markdown, every chapter in
// order with an expand/collapse deep-dive, and inline title / author editing
// wired to `PATCH /api/v1/books/:id`.
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

  const refresh = useCallback(async () => {
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
    refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  const save = useCallback(
    async (patch: { title?: string; author?: string | null }) => {
      const res = await api(`/api/v1/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        throw new Error(
          (await problemMessage(res)) ?? `save failed: ${res.status}`,
        );
      }
      await refresh();
    },
    [api, bookId, refresh],
  );

  return (
    <section>
      <button type="button" onClick={onBack}>
        &larr; Back to library
      </button>
      {error && <p role="alert">{error}</p>}
      {!book ? (
        <p>Loading book...</p>
      ) : (
        <>
          <EditableField
            label="Title"
            value={book.title}
            placeholder={book.originalFilename}
            onSave={(next) => save({ title: next ?? undefined })}
            nullable={false}
          />
          <EditableField
            label="Author"
            value={book.author}
            placeholder="Unknown author"
            onSave={(next) => save({ author: next })}
            nullable
          />

          <h3>Summary</h3>
          <Markdown text={book.summary} />

          <h3>Chapters</h3>
          {book.chapters.length === 0 ? (
            <p style={MUTED}>No chapters detected yet.</p>
          ) : (
            <ol>
              {book.chapters.map((chapter) => (
                <Chapter key={chapter.id} chapter={chapter} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

const MUTED: CSSProperties = { color: '#6b7280', fontStyle: 'italic' };

// A null-or-empty summary is a state, not an error: show a muted placeholder
// until the pipeline fills it.
function Markdown({ text }: { text: string | null }) {
  if (!text) return <p style={MUTED}>Not generated yet</p>;
  return (
    <div data-markdown>
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

function Chapter({ chapter }: { chapter: ChapterDto }) {
  const heading = chapter.title ?? `Chapter ${chapter.chapterIndex + 1}`;
  return (
    <li>
      <details>
        <summary>{heading}</summary>
        <Markdown text={chapter.summary} />
      </details>
    </li>
  );
}

// Inline edit for one field. Read-only text with an Edit button that swaps in
// an input; Save calls `PATCH`. `nullable` fields (author) send an explicit
// `null` when cleared; non-nullable fields (title) refuse an empty save.
function EditableField({
  label,
  value,
  placeholder,
  onSave,
  nullable,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onSave: (next: string | null) => Promise<void>;
  nullable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function begin() {
    setDraft(value ?? '');
    setError(null);
    setEditing(true);
  }

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed && !nullable) {
      setError(`${label} cannot be empty`);
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
      <p>
        <strong>{label}:</strong>{' '}
        {value ?? <span style={MUTED}>{placeholder}</span>}{' '}
        <button type="button" onClick={begin}>
          Edit
        </button>
      </p>
    );
  }

  return (
    <p>
      <strong>{label}:</strong>{' '}
      <input
        aria-label={label}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
      />{' '}
      <button type="button" onClick={() => void commit()} disabled={busy}>
        {busy ? 'Saving...' : 'Save'}
      </button>{' '}
      <button type="button" onClick={() => setEditing(false)} disabled={busy}>
        Cancel
      </button>
      {error && (
        <span role="alert" style={{ color: '#b91c1c' }}>
          {' '}
          {error}
        </span>
      )}
    </p>
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
