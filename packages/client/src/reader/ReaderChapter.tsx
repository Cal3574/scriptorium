import { useCallback, useEffect } from 'react';
import {
  Navigate,
  useNavigate,
  useNavigationType,
  useParams,
  useSearchParams,
} from 'react-router';

import { SummaryProse } from '@/components/prose/summary-prose';
import { NotGeneratedYet } from '@/components/book-detail/not-generated-yet';
import { chapterHeading, pageRange } from '@/books/chapter-display';
import { useReaderBook } from './reader-context';
import { chapterIndexFromParam } from './chapter-number';
import { useArrowNav } from './use-arrow-nav';
import { useSwipeNav } from './use-swipe-nav';
import { useChapterSource } from './use-chapter-source';
import { ReaderStrip } from './reader-strip';
import { SourcePanel } from './source-panel';

// `/books/:bookId/read/:chapterNumber` (1-based). The chapter summary by
// default; `?view=source` swaps the column for the reconstructed source text.
// Prev/next and the arrow keys walk between chapters with no wrap. A bad
// `:chapterNumber` redirects to the Overview.
export function ReaderChapter() {
  const book = useReaderBook();
  const { chapterNumber } = useParams();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [searchParams] = useSearchParams();

  const total = book.chapters.length;
  const index = chapterIndexFromParam(chapterNumber, total);
  const revealed = searchParams.get('view') === 'source';

  const basePath = useCallback(
    (n: number) => `/books/${book.id}/read/${n}`,
    [book.id],
  );

  // Prev/next and the arrow keys carry the current view forward, so Source
  // stays open as you move between chapters instead of resetting to Summary.
  const chapterPath = useCallback(
    (n: number) => `${basePath(n)}${revealed ? '?view=source' : ''}`,
    [basePath, revealed],
  );

  // Prev/next as push navigations. `index` is 0-based, so the previous
  // chapter's 1-based number is `index` and the next is `index + 2`.
  const goPrev = useCallback(
    () => navigate(chapterPath(index ?? 0)),
    [navigate, chapterPath, index],
  );
  const goNext = useCallback(
    () => navigate(chapterPath((index ?? 0) + 2)),
    [navigate, chapterPath, index],
  );
  const hasPrev = index != null && index > 0;
  const hasNext = index != null && index < total - 1;
  useArrowNav(hasPrev ? goPrev : noop, hasNext ? goNext : noop);
  const swipeRef = useSwipeNav<HTMLElement>(
    hasPrev ? goPrev : noop,
    hasNext ? goNext : noop,
  );

  const chapterId = index != null ? book.chapters[index].id : '';
  const sourceState = useChapterSource(book.id, chapterId, revealed);

  // Forward motion (prev/next, and toggling Summary <-> Source) lands at the
  // top of the column; browser back/forward is left to `<ScrollRestoration>`.
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo({ top: 0 });
  }, [navigationType, chapterNumber, revealed]);

  if (index == null) {
    return <Navigate to={`/books/${book.id}/read`} replace />;
  }

  const number = index + 1;
  const chapter = book.chapters[index];
  const range = pageRange(chapter);

  return (
    <div>
      <ReaderStrip
        number={number}
        total={total}
        onPrev={hasPrev ? goPrev : null}
        onNext={hasNext ? goNext : null}
        revealed={revealed}
        // Summary replaces the `?view=source` entry so the browser back button
        // returns straight to the previous chapter, never to a stale Source.
        onShowSummary={() => navigate(basePath(number), { replace: true })}
        onShowSource={() => navigate(`${basePath(number)}?view=source`)}
      />

      <article ref={swipeRef} className="mx-auto max-w-[68ch] pt-9 pb-24">
        <p className="text-muted-foreground m-0 font-mono text-[10.5px] tracking-[0.08em] uppercase">
          Chapter {number}
        </p>
        <h1 className="text-foreground mt-2 mb-1 font-serif text-2xl leading-tight font-normal">
          {chapterHeading(chapter, number)}
        </h1>
        {range && (
          <p className="text-muted-foreground mb-6 font-mono text-[11px]">
            pp. {range}
          </p>
        )}

        {revealed ? (
          <SourcePanel state={sourceState} range={range} />
        ) : chapter.summary ? (
          <SummaryProse markdown={chapter.summary} />
        ) : (
          <NotGeneratedYet />
        )}
      </article>
    </div>
  );
}

function noop(): void {
  /* at a chapter-list boundary the arrow key does nothing */
}
