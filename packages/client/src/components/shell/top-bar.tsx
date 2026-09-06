import { UserButton } from '@clerk/react';

import { NavLink } from './nav-link';
import { NAV_ITEMS } from './nav-items';
import { MobileNav } from './mobile-nav';
import { ThemeToggle } from './theme-toggle';
import { Wordmark } from './wordmark';

// The persistent top bar on every screen (#51). Left to right: wordmark,
// primary nav, then the right cluster (theme toggle, Clerk `<UserButton>`).
// Below `md` the nav row is swapped for the `MobileNav` hamburger; the
// wordmark, toggle and `<UserButton>` stay inline.
export function TopBar() {
  return (
    <header className="border-border bg-background sticky top-0 z-(--z-header) border-b">
      <div className="mx-auto flex h-(--header-height) w-full max-w-(--container-app) items-center gap-4 px-(--shell-gutter)">
        <Wordmark />

        <nav className="hidden items-center gap-4 md:flex" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} label={item.label} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <UserButton />
          <div className="md:hidden">
            <MobileNav />
          </div>
        </div>
      </div>
    </header>
  );
}
