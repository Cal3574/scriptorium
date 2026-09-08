import { Link } from 'react-router';
import type { UsageDto } from '@scriptorium/contracts';

import { cn } from '@/lib/utils';
import { resetDistance } from '@/usage/reset-distance';

// used/limit ratio -> visual state. Normal below 80%, amber from 80%, red at
// (or past) 100% - a former-Pro reader over the Free ceiling reads as red.
type MeterState = 'normal' | 'amber' | 'red';

function meterState(used: number, limit: number): MeterState {
  const ratio = limit <= 0 ? 1 : used / limit;
  if (ratio >= 1) return 'red';
  if (ratio >= 0.8) return 'amber';
  return 'normal';
}

const RANK: Record<MeterState, number> = { normal: 0, amber: 1, red: 2 };

const TEXT: Record<MeterState, string> = {
  normal: 'text-muted-foreground',
  amber: 'text-status-progress',
  red: 'text-status-failed',
};
const FILL: Record<MeterState, string> = {
  normal: 'bg-muted-foreground',
  amber: 'bg-status-progress',
  red: 'bg-status-failed',
};

function Track({
  label,
  used,
  limit,
  suffix,
}: {
  label: string;
  used: number;
  limit: number;
  suffix?: string;
}) {
  const state = meterState(used, limit);
  const pct = Math.round(Math.min(1, limit <= 0 ? 1 : used / limit) * 100);
  // The text keeps the true "7 / 2"; the bar and its ARIA value clamp to the
  // limit so an over-ceiling reader is a full, valid 100% track.
  const valueNow = Math.min(used, Math.max(limit, 0));

  return (
    <span className="flex flex-col gap-1">
      <span className={cn('font-mono text-xs', TEXT[state])}>
        {label} {used} / {limit}
        {suffix ? ` · ${suffix}` : ''}
      </span>
      <span
        className="bg-border h-[3px] w-24 overflow-hidden"
        role="progressbar"
        aria-label={`${label} ${used} of ${limit}`}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={valueNow}
      >
        <span
          className={cn('block h-full', FILL[state])}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

// The usage meter in the library toolbar: two compact tracks for the book and
// question allowances, coloured by how close each is to its limit. The whole
// meter links to `/pricing`; an "Upgrade to Pro" affordance shows only when a
// track is amber or red, and never on the Pro plan.
export function UsageMeter({ usage }: { usage: UsageDto }) {
  const worst = Math.max(
    RANK[meterState(usage.books.used, usage.books.limit)],
    RANK[meterState(usage.queries.used, usage.queries.limit)],
  );
  const showUpgrade = usage.plan !== 'pro' && worst >= RANK.amber;

  return (
    <Link
      to="/pricing"
      aria-label="View plans and pricing"
      className="focus-visible:ring-ring/50 flex items-center gap-4 rounded-sm no-underline outline-none focus-visible:ring-[3px]"
    >
      <Track label="Books" used={usage.books.used} limit={usage.books.limit} />
      <Track
        label="Questions"
        used={usage.queries.used}
        limit={usage.queries.limit}
        suffix={resetDistance(usage.queries.resetsAt)}
      />
      {showUpgrade && (
        <span className="text-primary text-xs font-medium whitespace-nowrap">
          Upgrade to Pro
        </span>
      )}
    </Link>
  );
}
