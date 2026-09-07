import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia)
    return () => undefined;
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

// Whether the reader has asked for reduced motion, read synchronously on the
// first render (unlike `motion`'s `useReducedMotion`, which reports `null`
// until an effect runs). Used to drop the reveal/transition wrappers entirely
// rather than animate to the end state, so the content is never opacity-gated.
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia(QUERY).matches,
    () => false,
  );
}
