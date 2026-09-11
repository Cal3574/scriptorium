import { useEffect } from 'react';

// `<-` / `->` move to the adjacent chapter. Suppressed while focus is in a text
// field (the reader has none today; this is future-proofing per #118). The
// caller passes no-ops at the ends, so there is no wrap-around.
export function useArrowNav(onPrev: () => void, onNext: () => void): void {
  useEffect(() => {
    function handle(event: KeyboardEvent): void {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }

      if (event.key === 'ArrowLeft') onPrev();
      else onNext();
    }

    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onPrev, onNext]);
}
