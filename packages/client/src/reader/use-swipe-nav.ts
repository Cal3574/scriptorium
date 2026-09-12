import { useEffect, useRef } from 'react';

// A left/right swipe on the reader column moves to the adjacent chapter,
// mirroring the arrow keys (#118 follow-up: mobile chapter navigation). Only
// horizontal-dominant, single-touch gestures past the threshold count, so
// vertical scrolling and text selection inside the Source panel are
// untouched - nothing is prevented or stopped. The caller passes no-ops at
// the ends, so there is no wrap-around.
const THRESHOLD_PX = 60;
const HORIZONTAL_DOMINANCE_RATIO = 1.5;

export function useSwipeNav<T extends HTMLElement>(
  onPrev: () => void,
  onNext: () => void,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    function handleStart(event: TouchEvent): void {
      if (event.touches.length !== 1) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      tracking = true;
    }

    function handleEnd(event: TouchEvent): void {
      if (!tracking) return;
      tracking = false;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < THRESHOLD_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_DOMINANCE_RATIO) return;

      if (dx > 0) onPrev();
      else onNext();
    }

    el.addEventListener('touchstart', handleStart, { passive: true });
    el.addEventListener('touchend', handleEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleStart);
      el.removeEventListener('touchend', handleEnd);
    };
  }, [onPrev, onNext]);

  return ref;
}
