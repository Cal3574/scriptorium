import { NavLink as RouterNavLink } from 'react-router';

import { cn } from '@/lib/utils';

// A single primary-nav link. Text only, no icon (#51). Wraps react-router's
// `NavLink` so the active route is emphasised and gets `aria-current="page"`
// for free. The active marker is a 2px accent underline directly under the
// label; the focus ring stays a small rounded pill around the padded link.
export function NavLink({ to, label }: { to: string; label: string }) {
  return (
    <RouterNavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'inline-flex items-center rounded-sm border-b-2 px-1 pt-1 pb-0.5 text-sm no-underline transition-colors outline-none',
          'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          isActive
            ? 'border-primary text-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground border-transparent font-normal',
        )
      }
    >
      {label}
    </RouterNavLink>
  );
}
