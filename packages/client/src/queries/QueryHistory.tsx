import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { QueryListItemDto } from '@scriptorium/contracts';
import { useApi } from '../auth/use-api';
import { MUTED, problemMessage } from '../books/problem';
import { askAgainPath } from './ask-again';

// The reader's past questions, newest first, as the full `/history` page. A
// row links to `/ask/:queryId`; a `failed` row (the query never reached
// `complete()`) is flagged inline and offers "Ask again", which navigates to
// `/ask?q=` to re-run the same question as a fresh `POST /queries`.
export function QueryHistory() {
  const api = useApi();
  const [items, setItems] = useState<QueryListItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api('/api/v1/queries');
    if (!res.ok) {
      throw new Error(
        (await problemMessage(res)) ?? `history failed: ${res.status}`,
      );
    }
    setItems((await res.json()) as QueryListItemDto[]);
  }, [api]);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  return (
    <section>
      <h2>Your questions</h2>
      {error ? (
        <p role="alert">{error}</p>
      ) : !items ? (
        <p>Loading your questions...</p>
      ) : items.length === 0 ? (
        <p>You haven&apos;t asked anything yet.</p>
      ) : (
        <ul data-history>
          {items.map((item) => (
            <HistoryRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryRow({ item }: { item: QueryListItemDto }) {
  const navigate = useNavigate();
  return (
    <li data-failed={item.failed}>
      <Link to={`/ask/${item.id}`}>{item.question}</Link>{' '}
      <span style={{ color: MUTED }}>
        {new Date(item.createdAt).toLocaleString()}
      </span>{' '}
      {item.failed && <span role="status">(failed)</span>}{' '}
      {item.failed && (
        <button
          type="button"
          onClick={() => navigate(askAgainPath(item.question))}
          aria-label={`Ask again: ${item.question}`}
        >
          Ask again
        </button>
      )}
    </li>
  );
}
