import { useEffect, useRef, useState } from 'react';

// Tracks which stop panel is currently nearest the vertical centre of the
// viewport and returns its index - the pinned visual renders the state for
// that index. A rAF-throttled scroll/resize read (not IntersectionObserver:
// IO only fires on threshold crossings, which makes the active step lag or
// stick during a fast scroll). This is scroll position read directly, so
// there is nothing to unit-test and nothing that runs when scripting is off.
export function useActiveStep(count: number): {
  activeStep: number;
  register: (index: number) => (el: HTMLElement | null) => void;
} {
  const [activeStep, setActiveStep] = useState(0);
  const els = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      const mid = window.innerHeight / 2;
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < count; i++) {
        const el = els.current[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const centre = (r.top + r.bottom) / 2;
        const dist = Math.abs(centre - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      setActiveStep(best);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [count]);

  const register = (index: number) => (el: HTMLElement | null) => {
    els.current[index] = el;
  };

  return { activeStep, register };
}
