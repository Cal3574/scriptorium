import { useEffect, useRef, useState } from 'react';

// Tracks which stop panel is currently in the middle of the viewport and
// returns its index - the pinned visual renders the state for that index.
// A thin band across the viewport centre (`rootMargin`) is the trigger zone;
// whichever panel overlaps it is active. This is scroll position read through
// IntersectionObserver, never scroll math, so there is nothing to unit-test
// and nothing that runs when scripting is off.
export function useActiveStep(count: number): {
  activeStep: number;
  register: (index: number) => (el: HTMLElement | null) => void;
} {
  const [activeStep, setActiveStep] = useState(0);
  const els = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const nodes = els.current.slice(0, count).filter(Boolean) as HTMLElement[];
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = els.current.indexOf(entry.target as HTMLElement);
          if (index >= 0) setActiveStep(index);
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [count]);

  const register = (index: number) => (el: HTMLElement | null) => {
    els.current[index] = el;
  };

  return { activeStep, register };
}
