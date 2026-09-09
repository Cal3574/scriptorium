import { Link, useNavigate } from 'react-router';
import type { QueryListItemDto } from '@scriptorium/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { askAgainPath } from '@/queries/ask-again';
import { relativeTime } from '@/queries/relative-time';

// Shared grid template for the header row and every history row.
export const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_8rem_6rem] items-center gap-x-3 px-4';

// One past question. The whole row is a link to `/ask/:queryId`; a query that
// never reached `complete()` (`failed`) also carries a `failed` chip and an
// "Ask again" ghost button that navigates to `/ask?q=` to re-run it as a
// fresh `POST /queries` (#67). Only markup - no network here.
export function HistoryRow({ item }: { item: QueryListItemDto }) {
  const navigate = useNavigate();

  return (
    <div
      className={cn(
        'group border-border hover:bg-accent/40 border-b py-2.5 last:border-b-0',
        ROW_GRID,
      )}
      data-failed={item.failed}
    >
      <Link
        to={`/ask/${item.id}`}
        className="text-foreground truncate font-serif text-[15px] leading-tight font-medium no-underline hover:underline"
      >
        {item.question}
      </Link>

      <time
        dateTime={item.createdAt}
        title={new Date(item.createdAt).toLocaleString()}
        className="text-muted-foreground font-mono text-xs tabular-nums"
      >
        {relativeTime(item.createdAt)}
      </time>

      <span className="flex justify-end">
        {item.failed && (
          <Badge
            variant="failed"
            role="status"
            className="uppercase tracking-wide"
          >
            failed
          </Badge>
        )}
      </span>

      {item.failed && (
        <span className="col-span-full flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => navigate(askAgainPath(item.question))}
            aria-label={`Ask again: ${item.question}`}
          >
            Ask again
          </Button>
        </span>
      )}
    </div>
  );
}
