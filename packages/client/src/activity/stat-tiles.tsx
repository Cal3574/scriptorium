import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { ActivityDto } from '@scriptorium/contracts';

import { Badge } from '@/components/ui/badge';
import { resetDistance } from '@/usage/reset-distance';

function Tile({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="border-border bg-card flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-muted-foreground font-mono text-[10px] font-medium tracking-[0.08em] uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function Figure({ children }: { children: ReactNode }) {
  return (
    <span className="text-foreground font-mono text-2xl leading-none font-semibold tabular-nums">
      {children}
    </span>
  );
}

const SUBLINE = 'text-muted-foreground mt-1 font-mono text-xs';

// The four headline tiles above the charts: three lifetime totals and the
// current question allowance. Free shows the plan name and a link to
// `/pricing`; Pro shows a plan badge and no link (per the spec).
export function StatTiles({ activity }: { activity: ActivityDto }) {
  const { totals, plan } = activity;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile label="Books uploaded">
        <Figure>{totals.books.toLocaleString()}</Figure>
        <span className={SUBLINE}>all time</span>
      </Tile>

      <Tile label="Questions asked">
        <Figure>{totals.questions.toLocaleString()}</Figure>
        <span className={SUBLINE}>all time</span>
      </Tile>

      <Tile label="Pages ingested">
        <Figure>{totals.pagesIngested.toLocaleString()}</Figure>
        <span className={SUBLINE}>across all books</span>
      </Tile>

      <Tile label="Plan">
        {plan.plan === 'pro' ? (
          <Badge className="w-fit uppercase tracking-wide">Pro</Badge>
        ) : (
          <Figure>Free</Figure>
        )}
        <span className={SUBLINE}>
          {plan.questionsUsed} / {plan.questionsLimit} questions ·{' '}
          {resetDistance(plan.resetsAt)}
        </span>
        {plan.plan !== 'pro' && (
          <Link
            to="/pricing"
            className="text-primary mt-1 text-xs font-medium hover:underline"
          >
            View plans
          </Link>
        )}
      </Tile>
    </div>
  );
}
