import { useCallback, useEffect, useState } from 'react';
import type { QueryDetailDto } from '@scriptorium/contracts';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScreenHeader } from '@/components/screen-header';
import { AnswerBlock } from '@/components/query/answer-block';
import { CitationList } from '@/components/query/citation-list';
import { RetrievedPassages } from '@/components/query/retrieved-passages';
import { useApi } from '../auth/use-api';
import { problemMessage } from '../books/problem';

// One past query, opened from history (#66). The answer, its citations and the
// retrieved passages render through the exact same components as a fresh
// answer (#65) - only `AnswerBlock` runs with `streaming={false}`, so there is
// no in-progress caret. A null `answer` (synthesis failed) shows a
// destructive `Alert` plus "Ask again", which re-runs the question as a fresh
// `POST /queries` via the `/ask?q=` prefill. `citations` is the frozen jsonb
// snapshot with no `marker` field, so markers are the 1-based list position;
// it still renders in full after a cited book is deleted.
export function QueryDetail({
  queryId,
  onAskAgain,
}: {
  queryId: string;
  onAskAgain: (question: string) => void;
}) {
  const api = useApi();
  const [query, setQuery] = useState<QueryDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api(`/api/v1/queries/${queryId}`);
    if (!res.ok) {
      throw new Error(
        (await problemMessage(res)) ?? `load failed: ${res.status}`,
      );
    }
    setQuery((await res.json()) as QueryDetailDto);
  }, [api, queryId]);

  useEffect(() => {
    setQuery(null);
    setError(null);
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load this question</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!query) return <QueryDetailSkeleton />;

  const sources = query.citations.map((c, i) => ({
    key: c.chunkId,
    marker: i + 1,
    bookTitle: c.bookTitle,
    chapterTitle: c.chapterTitle,
    chunkText: c.chunkText,
  }));

  return (
    <article>
      <ScreenHeader title={query.question} />

      {query.answer === null ? (
        <div className="space-y-4" data-failed-query>
          <Alert variant="destructive">
            <AlertTitle>This question failed</AlertTitle>
            <AlertDescription>No answer was generated for it.</AlertDescription>
          </Alert>
          <Button type="button" onClick={() => onAskAgain(query.question)}>
            Ask again
          </Button>
        </div>
      ) : (
        <>
          <AnswerBlock markdown={query.answer} streaming={false} />

          {sources.length > 0 && (
            <div className="mt-8 space-y-6">
              <div>
                <h2 className="text-foreground mb-2 font-serif text-lg font-semibold">
                  Citations
                </h2>
                <CitationList citations={sources} />
              </div>

              <RetrievedPassages passages={sources} />
            </div>
          )}
        </>
      )}
    </article>
  );
}

// The loading placeholder: the question-heading bar over a few answer lines,
// so the detail view does not flash a bare "Loading..." then the full page.
function QueryDetailSkeleton() {
  return (
    <article aria-busy="true" role="status">
      <span className="sr-only">Loading this question</span>
      <Skeleton className="mb-6 h-8 w-2/3" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-full" />
      </div>
    </article>
  );
}
