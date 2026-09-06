import { MenuIcon } from 'lucide-react';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NAV_ITEMS } from './nav-items';

// The primary nav, collapsed into a hamburger menu below the `md` breakpoint
// (#51). Only the trigger is ever rendered on wider screens - it is hidden by
// `md:hidden` in `TopBar`. Selecting an item navigates via react-router so the
// menu shares the app's client-side routing.
export function MobileNav() {
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open navigation menu">
          <MenuIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {NAV_ITEMS.map((item) => (
          <DropdownMenuItem key={item.to} onSelect={() => navigate(item.to)}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
