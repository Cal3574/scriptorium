import { CheckIcon, XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { TimelineRow } from '@/books/ingest-timeline';

// One step of the ingest timeline. The marker on the left sits on the
// connector spine drawn by the parent; `last` drops the trailing spine
// segment. `animate` is off for reduced-motion readers and when the stream
// has gone stale.
export function TimelineRowItem({
  row,
  last,
  animate,
  popDelayMs = 0,
}: {
  row: TimelineRow;
  last: boolean;
  animate: boolean;
  popDelayMs?: number;
}) {
  const { state } = row;

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* connector spine */}
      {!last && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-6 bottom-0 left-[11px] w-px',
            state === 'done' ? 'bg-status-ready' : 'bg-border',
          )}
        >
          {state === 'active' && animate && (
            <span className="ingest-spine-flow absolute inset-0" />
          )}
        </span>
      )}

      <Marker state={state} animate={animate} popDelayMs={popDelayMs} />

      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              'font-serif text-sm',
              state === 'pending' && 'text-muted-foreground',
              state === 'active' && 'text-foreground relative font-medium',
              state === 'done' && 'text-foreground',
              state === 'failed' && 'text-status-failed font-medium',
            )}
          >
            {row.label}
            {state === 'active' && animate && (
              <span
                aria-hidden="true"
                className="ingest-row-shimmer pointer-events-none absolute -inset-x-2 inset-y-0"
              />
            )}
          </span>
          {row.stat && (
            <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
              {row.stat}
            </span>
          )}
        </div>

        {row.subline && (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {row.subline}
          </p>
        )}

        {state === 'active' && row.detail && row.detail.total > 0 && (
          <div className="mt-1.5">
            <div className="text-muted-foreground font-mono text-xs tabular-nums">
              {row.detail.done.toLocaleString()} /{' '}
              {row.detail.total.toLocaleString()} {row.detail.unit}
            </div>
            <div className="bg-border mt-1 h-[3px] w-full overflow-hidden rounded-full">
              <div
                className="bg-status-progress h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.round(
                    (row.detail.done / row.detail.total) * 100,
                  )}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function Marker({
  state,
  animate,
  popDelayMs = 0,
}: {
  state: TimelineRow['state'];
  animate: boolean;
  popDelayMs?: number;
}) {
  if (state === 'done') {
    return (
      <span
        style={popDelayMs ? { animationDelay: `${popDelayMs}ms` } : undefined}
        className={cn(
          'bg-status-ready-soft text-status-ready z-10 flex size-[23px] shrink-0 items-center justify-center rounded-full',
          animate && 'ingest-check-pop',
        )}
      >
        <CheckIcon className="size-3.5" />
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="bg-status-failed-soft text-status-failed z-10 flex size-[23px] shrink-0 items-center justify-center rounded-full">
        <XIcon className="size-3.5" />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="border-status-progress bg-card relative z-10 flex size-[23px] shrink-0 items-center justify-center rounded-full border-2">
        {animate && (
          <span className="bg-status-progress absolute size-2 animate-ping rounded-full" />
        )}
        <span className="bg-status-progress size-2 rounded-full" />
      </span>
    );
  }
  return (
    <span className="border-border bg-card z-10 flex size-[23px] shrink-0 items-center justify-center rounded-full border">
      <span className="bg-border size-1.5 rounded-full" />
    </span>
  );
}
