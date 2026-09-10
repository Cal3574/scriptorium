import { useEffect, useRef, useState } from 'react';
import type { ChapterSourceDto } from '@scriptorium/contracts';
import { useApi } from '../auth/use-api';

export type ChapterSourceState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; source: ChapterSourceDto }
  // 404 / 409: the book was deleted or left `ready` while it was open. The
  // caller keeps the summary on screen and shows a quiet inline error.
  | { status: 'gone' }
  | { status: 'error' };

// Fetch `GET /books/:bookId/chapters/:chapterId/source` the first time a
// chapter's source is revealed (`revealed` follows `?view=source`), and cache
// the result per `chapterId` for the life of the reader so flipping
// Summary <-> Source, or walking back to a chapter, never refetches.
export function useChapterSource(
  bookId: string,
  chapterId: string,
  revealed: boolean,
): ChapterSourceState {
  const api = useApi();
  // Keyed by `bookId/chapterId` so a chapter id reused across books can never
  // serve another book's source. No invalidation: a `ready` book's source is a
  // finished artifact (per #118).
  const cache = useRef(new Map<string, ChapterSourceDto>());
  const cacheKey = `${bookId}/${chapterId}`;
  const [state, setState] = useState<ChapterSourceState>({ status: 'idle' });

  useEffect(() => {
    if (!revealed) {
      setState({ status: 'idle' });
      return;
    }

    const cached = cache.current.get(cacheKey);
    if (cached) {
      setState({ status: 'ready', source: cached });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });
    api(`/api/v1/books/${bookId}/chapters/${chapterId}/source`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404 || res.status === 409) {
          setState({ status: 'gone' });
          return;
        }
        if (!res.ok) {
          setState({ status: 'error' });
          return;
        }
        const source = (await res.json()) as ChapterSourceDto;
        cache.current.set(cacheKey, source);
        if (!cancelled) setState({ status: 'ready', source });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [api, bookId, chapterId, cacheKey, revealed]);

  return state;
}
