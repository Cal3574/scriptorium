import { Link } from 'react-router';

import { cn } from '@/lib/utils';
import { Monogram } from './monogram';

// The Scriptorium wordmark in the top bar: the slate monogram mark beside the
// word, always linking home (`/`). Below the `md` breakpoint the word drops
// and just the mark is kept (#51); the full name stays on the link's
// `aria-label` for assistive tech.
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      aria-label="Scriptorium home"
      className={cn(
        'flex items-center gap-2 no-underline',
        'focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-[3px]',
        className,
      )}
    >
      <Monogram className="size-6 shrink-0" />
      <span className="text-foreground hidden font-serif text-lg font-medium tracking-tight md:inline">
        Scriptorium
      </span>
    </Link>
  );
}
