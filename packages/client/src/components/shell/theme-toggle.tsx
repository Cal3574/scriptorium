import { ThemeSelector } from './theme-selector';

// Backwards-compatible name for callers/tests that still mount the old shell
// control directly. The implementation is now a named scheme selector rather
// than a binary light/dark toggle.
export function ThemeToggle() {
  return <ThemeSelector />;
}
