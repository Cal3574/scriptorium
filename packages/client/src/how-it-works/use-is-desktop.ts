import { useSyncExternalStore } from 'react';

const QUERY = '(min-width: 64rem)'; // Tailwind's `lg`

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia)
    return () => undefined;
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

// Whether the layout is at the `lg` breakpoint or wider. Used to render the
// pinned stage - and its WebGL canvas - in exactly one place (the desktop
// column or the mobile band), never both, so only one GL context is ever
// live. SSR / first paint reports mobile, then corrects on mount.
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia(QUERY).matches,
    () => false,
  );
}
