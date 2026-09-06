import { NavLink as RouterNavLink } from 'react-router';

import { cn } from '@/lib/utils';

// A single primary-nav link. Text only, no icon (#51). Wraps react-router's
// `NavLink` so the active route is emphasised (foreground + weight) and gets
// `aria-current="page"` for free; inactive links sit in muted foreground.
export function NavLink({ to, label }: { to: string; label: string }) {
  return (
    <RouterNavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'rounded-sm px-1 py-0.5 text-sm no-underline transition-colors outline-none',
          'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          isActive
            ? 'text-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground font-normal',
        )
      }
    >
      {label}
    </RouterNavLink>
  );
}
