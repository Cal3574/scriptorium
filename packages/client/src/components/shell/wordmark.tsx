import { Link } from 'react-router';

import { cn } from '@/lib/utils';

// The Scriptorium wordmark in the top bar. Always links home (`/`). Below the
// `md` breakpoint it collapses to a single-glyph mark so the bar stays usable
// on narrow screens (#51); the full word is kept for assistive tech.
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      aria-label="Scriptorium home"
      className={cn(
        'text-foreground font-serif text-lg font-medium tracking-tight no-underline',
        'focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-[3px]',
        className,
      )}
    >
      <span className="hidden md:inline">Scriptorium</span>
      <span className="md:hidden" aria-hidden="true">
        S
      </span>
    </Link>
  );
}
