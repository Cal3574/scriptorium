import type { ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { chapterOrdinal } from '@/books/chapter-display';

// The reader's sticky top strip (Direction B): prev/next (disabled at the
// ends, no wrap), the `NN / NN` counter, and the `[ Summary | Source ]`
// segmented control. It stays put while the content column scrolls.
export function ReaderStrip({
  number,
  total,
  onPrev,
  onNext,
  revealed,
  onShowSummary,
  onShowSource,
}: {
  number: number;
  total: number;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  revealed: boolean;
  onShowSummary: () => void;
  onShowSource: () => void;
}) {
  return (
    <div className="border-border bg-background sticky top-0 z-10 flex items-center gap-3 border-b py-2.5">
      <div className="flex gap-1">
        <StripButton onClick={onPrev} label="Previous chapter">
          <ChevronLeftIcon className="size-4" />
        </StripButton>
        <StripButton onClick={onNext} label="Next chapter">
          <ChevronRightIcon className="size-4" />
        </StripButton>
      </div>
      <span className="text-muted-foreground font-mono text-[11px]">
        {chapterOrdinal(number)} / {chapterOrdinal(total)}
      </span>
      <div
        role="group"
        aria-label="View"
        className="border-border ml-auto inline-flex overflow-hidden rounded border"
      >
        <SegButton pressed={!revealed} onClick={onShowSummary}>
          Summary
        </SegButton>
        <SegButton pressed={revealed} onClick={onShowSource}>
          Source
        </SegButton>
      </div>
    </div>
  );
}

function StripButton({
  onClick,
  label,
  children,
}: {
  onClick: (() => void) | null;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick ?? undefined}
      disabled={onClick == null}
      aria-label={label}
      className="border-border bg-card text-muted-foreground hover:text-foreground inline-flex items-center rounded border px-2 py-1 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SegButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'px-3.5 py-1.5 font-mono text-[11.5px] tracking-[0.03em] uppercase',
        pressed
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
