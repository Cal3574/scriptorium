import { Link } from 'react-router';
import { TriangleAlertIcon } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { LimitCode } from '@/books/problem';
import { useUsage } from './use-usage';

// The inline "you've hit a plan limit" notice, rendered in place of the call
// site's usual error - the book upload control and the ask screen (#108).
// Deliberately not a modal: it sits where the error alert would, shows the
// live counts from `useUsage()` (the call site refetches on the 402, so these
// are current), and offers one action to `/pricing`.
//
// The copy is client-authored: the 402 body's `detail` is human text for
// logs, not a contract, and the notice pairs it with the live numbers and the
// reader's plan anyway - all of which it already has from `useUsage()`.
const NOTICE: Record<LimitCode, { title: string; lever: 'books' | 'queries' }> =
  {
    book_limit_reached: {
      title: "You've reached your book limit",
      lever: 'books',
    },
    query_limit_reached: {
      title: "You've reached your monthly question limit",
      lever: 'queries',
    },
  };

const NOUN = { books: 'books', queries: 'questions' } as const;

export function LimitReachedNotice({ code }: { code: LimitCode }) {
  const { usage } = useUsage();
  const { title, lever } = NOTICE[code];
  const noun = NOUN[lever];
  const allowance = usage ? usage[lever] : null;
  // A Pro reader can still hit the (higher) Pro ceiling; only a Free reader
  // has somewhere to upgrade to.
  const canUpgrade = usage?.plan !== 'pro';

  return (
    <Alert variant="destructive" className="mb-6">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="gap-3">
        <span>
          {allowance
            ? `You've used ${allowance.used} of ${allowance.limit} ${noun}. `
            : `Your ${noun} allowance is used up. `}
          {canUpgrade
            ? 'Upgrade to Pro for a higher limit.'
            : 'This is the Pro plan ceiling.'}
        </span>
        <Button asChild size="sm">
          <Link to="/pricing">
            {canUpgrade ? 'Upgrade to Pro' : 'View plans'}
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
