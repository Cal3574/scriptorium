import { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import type { QueryDetailDto } from '@scriptorium/contracts';
import { useApi } from '../auth/use-api';
import { MUTED, problemMessage } from '../books/problem';

// One past query, opened from history: the full question, its answer and
// citations (or a "failed" state when `answer` is null), and the retrieved
// passages behind it. `citations` is the frozen snapshot, so it still renders
// after a cited book is deleted.
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

  if (error) return <p role="alert">{error}</p>;
  if (!query) return <p>Loading question...</p>;

  return (
    <article>
      <h3>{query.question}</h3>

      {query.answer === null ? (
        <div role="alert" data-failed-query>
          <p>This question failed - no answer was generated.</p>
          <button type="button" onClick={() => onAskAgain(query.question)}>
            Ask again
          </button>
        </div>
      ) : (
        <>
          <div data-answer>
            <Markdown>{query.answer}</Markdown>
          </div>

          {query.citations.length > 0 && (
            <>
              <h4>Citations</h4>
              <ol data-citations>
                {query.citations.map((c) => (
                  <li key={c.chunkId}>
                    {c.bookTitle} - {c.chapterTitle}
                  </li>
                ))}
              </ol>

              <h4>Retrieved passages</h4>
              <ul data-passages style={{ listStyle: 'none', paddingLeft: 0 }}>
                {query.citations.map((c, index) => (
                  <li key={c.chunkId} style={{ marginBottom: '1rem' }}>
                    <strong>
                      [{index + 1}] {c.bookTitle} - {c.chapterTitle}
                    </strong>
                    <blockquote style={{ color: MUTED, marginLeft: 0 }}>
                      {c.chunkText}
                    </blockquote>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </article>
  );
}
