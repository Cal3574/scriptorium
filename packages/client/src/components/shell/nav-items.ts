// The primary nav sections, in fixed order (#51). Shared by the desktop nav
// row in `TopBar` and the collapsed `MobileNav` menu so the two never drift.
export const NAV_ITEMS = [
  { to: '/library', label: 'Library' },
  { to: '/ask', label: 'Ask' },
  { to: '/history', label: 'History' },
  { to: '/activity', label: 'Activity' },
  { to: '/how-it-works', label: 'How it works' },
] as const;
