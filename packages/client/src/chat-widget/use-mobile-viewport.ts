import { useSyncExternalStore } from 'react';

// The same breakpoint the app's mobile nav already splits on (`TopBar` /
// `MobileNav`, #51: `hidden md:flex` / `md:hidden`) - Tailwind's `md`,
// 48rem/768px. The chat widget (#164) keys its desktop-panel-vs-mobile-
// takeover choice off this same query so the two splits never disagree.
const QUERY = '(max-width: 47.9975rem)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia)
    return () => undefined;
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia(QUERY).matches
  );
}

// Whether the viewport is below the `md` breakpoint. SSR / first paint
// reports desktop, then corrects on mount - there is no server render here
// today, but this keeps the same shape as `useIsDesktop` (how-it-works).
export function useIsMobileViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
