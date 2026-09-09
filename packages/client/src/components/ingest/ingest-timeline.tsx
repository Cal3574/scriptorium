import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { BookListItemDto } from '@scriptorium/contracts';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { buildTimeline } from '@/books/ingest-timeline';
import { formatElapsed } from '@/books/elapsed';
import { usePassageMark } from '@/books/use-passage-mark';
import type { IngestProgress } from '@/books/use-ingest-events';
import { TimelineRowItem } from './timeline-row';

// How long the SSE stream may be silent before the panel calls itself stale
// and settles its animations (the endpoint heart-beats every 15s).
const STALE_AFTER_MS = 20_000;

type PanelBook = Pick<
  BookListItemDto,
  | 'id'
  | 'title'
  | 'originalFilename'
  | 'createdAt'
  | 'status'
  | 'failedStage'
  | 'failureReason'
>;

// The ingest pipeline as a live vertical timeline. Presentational: it is fed
// the folded SSE progress and the connection flag from whichever screen owns
// the `useIngestEvents` subscription (the library row, or BookDetail), and
// renders the five steps, their live figures, and the terminal hand-off.
export function IngestTimeline({
  book,
  progress,
  connected,
  onRetry,
  className,
}: {
  book: PanelBook;
  progress: IngestProgress | null;
  connected: boolean;
  onRetry?: () => void | Promise<void>;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const passagesTotalMark = usePassageMark(progress);

  const status = progress?.status ?? book.status;
  const timeline = buildTimeline({
    status,
    stage: progress?.stage ?? null,
    progress: progress?.progress ?? null,
    chaptersTotal: progress?.chaptersTotal ?? null,
    chaptersSummarized: progress?.chaptersSummarized ?? null,
    title: progress?.title ?? book.title,
    author: progress?.author ?? null,
    failedStage: progress?.failedStage ?? book.failedStage,
    passagesTotalMark,
  });
  const { phase, rows } = timeline;
  const running = phase === 'running' || phase === 'queued';

  const stale = useStale(connected, running);
  const animate = !reduced && !stale;
  const elapsed = useElapsed(book.createdAt, running);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function retry() {
    if (!onRetry) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await onRetry();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex flex-col gap-4', className)}
    >
      <header className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground m-0 font-mono text-xs tabular-nums">
          {elapsedLabel(phase, elapsed)}
        </p>
        <LiveBadge phase={phase} connected={connected} stale={stale} />
      </header>

      <ol className="m-0 list-none p-0">
        {rows.map((row, i) => (
          <TimelineRowItem
            key={row.id}
            row={row}
            last={i === rows.length - 1}
            animate={animate}
            popDelayMs={phase === 'done' && animate ? i * 80 : 0}
          />
        ))}
      </ol>

      {phase === 'done' && (
        <div className="border-border flex items-center justify-between gap-3 border-t pt-4">
          <p className="text-foreground m-0 font-serif text-sm">
            Summary ready
          </p>
          <Button asChild size="sm">
            <Link to={`/books/${book.id}`}>Read the summary</Link>
          </Button>
        </div>
      )}

      {phase === 'failed' && (
        <div className="border-border flex flex-col gap-2 border-t pt-4">
          {book.failureReason && (
            <p className="text-muted-foreground m-0 text-xs">
              {book.failureReason}
            </p>
          )}
          {onRetry && (
            <Button
              type="button"
              size="sm"
              onClick={() => void retry()}
              disabled={retrying}
              className="self-start"
            >
              {retrying ? 'Retrying…' : 'Retry'}
            </Button>
          )}
          {retryError && (
            <p role="alert" className="text-status-failed m-0 text-xs">
              {retryError}
            </p>
          )}
        </div>
      )}

      {running && phase !== 'queued' && (
        <p className="text-muted-foreground m-0 text-xs">
          Most books finish within a few minutes. You can leave this page - it
          keeps going.
        </p>
      )}
    </div>
  );
}

// The running-span line. `formatElapsed` returns the literal "just now" for
// the first few seconds, which does not take the "Started … ago" frame.
function elapsedLabel(phase: string, elapsed: string): string {
  const immediate = elapsed === 'just now';
  if (phase === 'done') return `Done in ${elapsed}`;
  if (phase === 'failed') {
    return immediate ? 'Stopped just now' : `Stopped after ${elapsed}`;
  }
  return immediate ? 'Started just now' : `Started ${elapsed} ago`;
}

function LiveBadge({
  phase,
  connected,
  stale,
}: {
  phase: string;
  connected: boolean;
  stale: boolean;
}) {
  if (phase === 'done' || phase === 'failed') return null;
  const live = connected && !stale;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[10px] font-medium tracking-[0.08em] uppercase',
        live ? 'text-status-ready' : 'text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          live ? 'bg-status-ready animate-pulse' : 'bg-muted-foreground',
        )}
      />
      {live ? 'Live' : 'Reconnecting…'}
    </span>
  );
}

// True once the stream has been disconnected for `STALE_AFTER_MS` while work
// is still in flight. Resets the instant the connection returns.
function useStale(connected: boolean, running: boolean): boolean {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (connected || !running) {
      setStale(false);
      return;
    }
    const id = setTimeout(() => setStale(true), STALE_AFTER_MS);
    return () => clearTimeout(id);
  }, [connected, running]);
  return stale;
}

// The running elapsed span, ticking each second while work is live and frozen
// at its final value once the book settles.
function useElapsed(fromIso: string, running: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  const frozen = useRef<string | null>(null);

  useEffect(() => {
    if (!running) return;
    frozen.current = null;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  if (!running) {
    frozen.current ??= formatElapsed(fromIso, now);
    return frozen.current;
  }
  return formatElapsed(fromIso, now);
}
