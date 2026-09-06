import '@testing-library/jest-dom';

// jsdom implements neither of the two browser APIs the How-it-works page (and
// `motion`'s in-view triggers) depend on. Stub both at the setup level so
// every spec gets them; individual specs can still override `matchMedia` to
// simulate `prefers-reduced-motion: reduce`.

// A no-op IntersectionObserver that reports every observed element as visible
// straight away - the scroll-driven reveal has nothing to gate in jsdom, so
// content should simply be present.
class TestIntersectionObserver {
  private readonly cb: IntersectionObserverCallback;

  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }

  observe(target: Element): void {
    this.cb(
      [
        {
          isIntersecting: true,
          intersectionRatio: 1,
          target,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }

  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.IntersectionObserver ??=
  TestIntersectionObserver as unknown as typeof IntersectionObserver;

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
