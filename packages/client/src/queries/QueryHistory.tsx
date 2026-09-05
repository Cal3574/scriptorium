import { useCallback, useEffect, useState } from 'react';
import { MessageSquareIcon } from 'lucide-react';
import type { QueryListItemDto } from '@scriptorium/contracts';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { EmptyState } from '@/components/empty-state';
import { ScreenHeader } from '@/components/screen-header';
import {
  HistoryList,
  HistoryListSkeleton,
} from '@/components/history/history-list';
import { useApi } from '../auth/use-api';
import { problemMessage } from '../books/problem';

// `3 questions · 1 failed` - the questions count is always shown; the failed
// segment only when non-zero.
function summarise(items: QueryListItemDto[]): string {
  const failed = items.filter((item) => item.failed).length;
  const parts = [
    `${items.length} ${items.length === 1 ? 'question' : 'questions'}`,
  ];
  if (failed) parts.push(`${failed} failed`);
  return parts.join(' · ');
}

// The reader's past questions, newest first, as the full `/history` page.
// Restyled to the Console worklist (#67): the `/history` GET and every error
// path are unchanged from the pre-restyle screen - only the markup moved. A
// row links to `/ask/:queryId`; a `failed` row also offers "Ask again", which
// navigates to `/ask?q=` to re-run the question as a fresh `POST /queries`.
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
      <ScreenHeader
        title="History"
        summary={items ? summarise(items) : undefined}
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Couldn&apos;t load your questions</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!items ? (
        <HistoryListSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={MessageSquareIcon}
          title="No questions yet"
          body="You haven't asked anything yet. Head to Ask and put a question to your library."
        />
      ) : (
        <HistoryList items={items} />
      )}
    </section>
  );
}
