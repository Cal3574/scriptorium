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
  render() {
    if (this.state.failed) return <FallbackVisual step={this.props.step} />;
    return this.props.children;
  }
}

function GlowBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute top-1/4 left-1/5 h-72 w-72 rounded-full opacity-40 blur-3xl motion-safe:animate-pulse [background:radial-gradient(circle,var(--primary),transparent_70%)]" />
      <div className="absolute right-1/6 bottom-1/5 h-64 w-64 rounded-full opacity-30 blur-3xl [animation-delay:1.5s] motion-safe:animate-pulse [background:radial-gradient(circle,var(--status-progress),transparent_70%)]" />
      <div className="absolute top-1/2 left-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl [background:radial-gradient(circle,var(--primary),transparent_75%)]" />
    </div>
  );
}

// The pinned visual slot. Decides between the real 3-D scene and the flat
// fallback, keeps the WebGL canvas mounted across steps (so it morphs instead
// of re-initialising), and floats the real product component on top at the
// two payoff stops.
export function PinnedStage({ step }: { step: number }) {
  const reduce = usePrefersReducedMotion();
  const [webgl, setWebgl] = useState(false);

  // Probe after mount only - keeps the server/first render deterministic and
  // the test environment (no WebGL) on the fallback path.
  useEffect(() => {
    if (!reduce) setWebgl(supportsWebGL());
  }, [reduce]);

  const canRender3D = !reduce && webgl;
  const payoff = isPayoffStep(step);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <GlowBackdrop />

      {canRender3D ? (
        <SceneBoundary step={step}>
          <Suspense fallback={<FallbackVisual step={step} />}>
            <Scene3D step={step} />
          </Suspense>
        </SceneBoundary>
      ) : (
        !payoff && <FallbackVisual step={step} />
      )}

      {payoff && (
        <div className="relative z-10 flex h-full w-full items-center justify-center">
          <PayoffCard step={step} />
        </div>
      )}
    </div>
  );
}
