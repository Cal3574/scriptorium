import { cn } from '@/lib/utils';

// The 3px progress bar under a working book's stage line (#54). `value` is
// 0..1; when the stage reports no countable total the track is shown
// indeterminate (a full-width muted fill) rather than hidden, so the row
// still reads as "in motion".
export function ProgressTrack({
  value,
  indeterminate = false,
}: {
  value?: number;
  indeterminate?: boolean;
}) {
  const pct = indeterminate
    ? 100
    : Math.round(Math.min(1, Math.max(0, value ?? 0)) * 100);

  return (
    <div
      className="bg-border mt-1.5 h-[3px] w-full overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
    >
      <div
        className={cn(
          'bg-status-progress h-full transition-[width] duration-300',
          indeterminate && 'opacity-40',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
