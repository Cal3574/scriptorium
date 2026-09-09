import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { FallbackVisual } from './FallbackVisual';
import { PayoffCard } from './PayoffCard';
import { isPayoffStep } from './payoff-samples';
import { supportsWebGL } from './supports-webgl';
import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

// The 3-D scene is a large chunk (three.js); keep it out of the main bundle
// and only fetch it once we know it will actually be used.
const Scene3D = lazy(() => import('./Scene3D'));

// If WebGL dies mid-scene (context loss, driver crash) we must not take the
// page down with it - drop to the flat visual instead.
class SceneBoundary extends Component<
  { step: number; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error('[HowItWorks] 3-D scene failed; using the flat visual:', err);
  }
  render() {
    if (this.state.failed) return <FallbackVisual step={this.props.step} />;
    return this.props.children;
  }
}

// The pinned visual slot. Chooses the real 3-D scene or the flat fallback,
// keeps the WebGL canvas mounted across steps (so it morphs instead of
// re-initialising), and floats the real product component on top at the two
// payoff stops. The scene sits in a plain sized div - the canonical r3f
// layout - so three.js measures it reliably.
//
// `mode` is a three-way: `detecting` renders an empty slot for the one tick
// before the effect resolves WebGL support, so a WebGL visitor never sees the
// flat SVG flash past on the way to the 3-D scene. The flat visual is shown
// only when it is the real answer (no WebGL / reduced motion), and the
// Suspense fallback for the three.js chunk is blank for the same reason.
type SceneMode = 'detecting' | 'webgl' | 'flat';

export function PinnedStage({ step }: { step: number }) {
  const reduce = usePrefersReducedMotion();
  const [mode, setMode] = useState<SceneMode>('detecting');

  useEffect(() => {
    setMode(!reduce && supportsWebGL() ? 'webgl' : 'flat');
  }, [reduce]);

  const payoff = isPayoffStep(step);

  return (
    <div className="relative h-full w-full">
      {mode === 'webgl' ? (
        <div className="h-full w-full">
          <SceneBoundary step={step}>
            <Suspense fallback={<div className="h-full w-full" />}>
              <Scene3D step={step} />
            </Suspense>
          </SceneBoundary>
        </div>
      ) : (
        mode === 'flat' &&
        !payoff && (
          <div className="absolute inset-0">
            <FallbackVisual step={step} />
          </div>
        )
      )}

      {payoff && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
          <PayoffCard step={step} />
        </div>
      )}
    </div>
  );
}
