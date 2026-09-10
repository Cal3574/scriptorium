import { UserButton } from '@clerk/react';

import { Separator } from '@/components/ui/separator';
import { NavLink } from './nav-link';
import { NAV_ITEMS } from './nav-items';
import { MobileNav } from './mobile-nav';
import { ThemeToggle } from './theme-toggle';
import { Wordmark } from './wordmark';

// The persistent top bar on every screen (#51). Left to right: wordmark,
// primary nav, then the right cluster (theme toggle, a divider, the Clerk
// `<UserButton>`). Below `md` the nav row is swapped for the `MobileNav`
// hamburger. The bar sits on `bg-card` with the one ambient shadow so it
// reads as a raised surface, not a hairline.
export function TopBar() {
  return (
    <header className="border-border bg-card sticky top-0 z-(--z-header) border-b shadow-xs">
      <div className="mx-auto flex h-(--header-height) w-full max-w-(--container-app) items-center gap-6 px-(--shell-gutter)">
        <Wordmark />

        <nav className="hidden items-center gap-5 md:flex" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} label={item.label} />
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Separator orientation="vertical" className="hidden !h-5 sm:block" />
          <UserButton />
          <div className="md:hidden">
            <MobileNav />
          </div>
        </div>
      </div>
    </header>
  );
}
