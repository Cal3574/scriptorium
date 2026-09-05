import { useCallback, useEffect, useState } from 'react';
import type { QueryListItemDto } from '@scriptorium/contracts';
import { useApi } from '../auth/use-api';
import { MUTED, problemMessage } from '../books/problem';

// The reader's past questions, newest first. A `failed` row (the query never
// reached `complete()`) is flagged inline; `onAskAgain` re-runs the same
// question as a fresh `POST /queries` rather than trying to resume the old
// one.
export function QueryHistory({
  onOpen,
  onAskAgain,
}: {
  onOpen: (id: string) => void;
  onAskAgain: (question: string) => void;
}) {
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

  if (error) return <p role="alert">{error}</p>;
  if (!items) return <p>Loading your questions...</p>;
  if (items.length === 0) return <p>You haven&apos;t asked anything yet.</p>;

  return (
    <ul data-history>
      {items.map((item) => (
        <HistoryRow
          key={item.id}
          item={item}
          onOpen={onOpen}
          onAskAgain={onAskAgain}
        />
      ))}
    </ul>
  );
}

function HistoryRow({
  item,
  onOpen,
  onAskAgain,
}: {
  item: QueryListItemDto;
  onOpen: (id: string) => void;
  onAskAgain: (question: string) => void;
}) {
  return (
    <li data-failed={item.failed}>
      <button type="button" onClick={() => onOpen(item.id)}>
        {item.question}
      </button>{' '}
      <span style={{ color: MUTED }}>
        {new Date(item.createdAt).toLocaleString()}
      </span>{' '}
      {item.failed && <span role="status">(failed)</span>}{' '}
      {item.failed && (
        <button
          type="button"
          onClick={() => onAskAgain(item.question)}
          aria-label={`Ask again: ${item.question}`}
        >
          Ask again
        </button>
      )}
    </li>
  );
}
