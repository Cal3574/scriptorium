import { useEffect, useRef } from 'react';

// Makes the device back button/gesture close the mobile takeover instead of
// navigating the underlying app away from it (#164). While `active`, a
// synthetic history entry is pushed so the very next back press lands on
// `popstate` here rather than on the app's real previous location; a second
// back press then behaves normally. The entry is consumed either way: by the
// browser itself when the user actually goes back (the `popstate` branch), or
// by us calling `history.back()` on cleanup when `active` turns false for any
// other reason (the close button, switching to desktop). Only ever called for
// the mobile takeover - the desktop floating panel never touches history.
export function useWidgetBackClose(active: boolean, onClose: () => void): void {
  const consumedByPopRef = useRef(false);

  useEffect(() => {
    if (!active) return;

    window.history.pushState({ chatWidgetTakeover: true }, '');
    consumedByPopRef.current = false;

    const handlePopState = () => {
      consumedByPopRef.current = true;
      onClose();
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (!consumedByPopRef.current) {
        window.history.back();
      }
    };
  }, [active, onClose]);
}
