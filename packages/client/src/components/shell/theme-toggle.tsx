import { MoonIcon, SunIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTheme } from '@/theme';

// The top-bar light/dark control: a single `icon`-size button, left of the
// Clerk `<UserButton>`. Drives `useTheme().toggle` (#53). The icon shows the
// current theme; the `aria-label` names the action it performs.
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label =
    theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={label}
    >
      {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
    </Button>
  );
}
