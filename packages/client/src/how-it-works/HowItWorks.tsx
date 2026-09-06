import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { HERO, RECAP, STOPS } from './stops';
import { PinnedStage } from './PinnedStage';
import { useActiveStep } from './use-active-step';
import { useIsDesktop } from './use-is-desktop';

// The "How it works" page (#83): the whole pipeline as one continuous,
// scroll-driven journey. Short text panels move past a single pinned visual -
// a real 3-D scene where WebGL and motion are available, a flat themed
// fallback everywhere else - that transforms across the eleven stops: a book
// becoming a summary, then a question becoming a cited answer. The account is
// concept-only (no vendor, model, or infrastructure names) so it stays correct
// when the internals change. Every panel's text and the fallback visuals are
// in the DOM without scroll or animation, so the explanation survives reduced
// motion and disabled scripting.

const ACT_LABELS = {
  reading: 'Reading a book',
  asking: 'Asking a question',
} as const;

// A stop panel. Deliberately plain and always visible - the movement on this
// page is the pinned 3-D stage, not the text. Kept tall so each stop holds the
// centre of the viewport for a while and the stage has room to morph.
function Panel({
  register,
  children,
}: {
  register: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section
      ref={register}
      className="flex min-h-[64vh] flex-col justify-center py-12"
    >
      {children}
    </section>
  );
}

// A dark "viewport into the machine" in both app themes - the `dark` scope
// makes its tokens and the 3-D palette resolve dark, so the glow reads and
// dark mode never flashes a light panel. The inset ring + vignette give it a
// framed, cinematic edge rather than a bare rectangle.
function Stage({ step }: { step: number }) {
  return (
    <div className="dark bg-background border-border/80 relative h-full w-full overflow-hidden rounded-2xl border">
      <PinnedStage step={step} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/5 [box-shadow:inset_0_0_140px_20px_rgba(0,0,0,0.55)]"
      />
    </div>
  );
}

export function HowItWorks() {
  const { activeStep, register } = useActiveStep(STOPS.length);
  const isDesktop = useIsDesktop();

  return (
    <div className="relative">
      {/* Page-wide ambient glow, kept faint so light mode stays calm. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-8 -z-10 h-[55vh] opacity-50 [background:radial-gradient(55%_60%_at_50%_0%,var(--primary),transparent_70%)] [mask-image:linear-gradient(black,transparent)]"
      />

      <header className="relative flex min-h-[55vh] flex-col justify-center py-16 text-center">
        <p className="text-muted-foreground mb-4 font-mono text-xs tracking-[0.3em] uppercase">
          How it works
        </p>
        <h1 className="text-foreground m-0 font-serif text-4xl leading-tight font-semibold text-balance sm:text-5xl">
          {HERO.title}
        </h1>
        <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-lg text-pretty">
          {HERO.promise}
        </p>
        <p className="text-muted-foreground mt-12 text-sm tracking-wide">
          {HERO.scrollCue}
          <span
            aria-hidden="true"
            className="mt-2 block text-lg motion-safe:animate-bounce"
          >
            &darr;
          </span>
        </p>
      </header>

      {/* Mobile: the pinned stage as a sticky band under the top bar. */}
      {!isDesktop && (
        <div className="bg-background/80 border-border/60 sticky top-(--header-height) z-10 -mx-(--shell-gutter) mb-6 h-64 border-y p-2 backdrop-blur">
          <Stage step={activeStep} />
        </div>
      )}

      {/* Desktop: a two-column journey - narrow text rail, wide pinned stage. */}
      <div className="lg:grid lg:grid-cols-[21rem_minmax(0,1fr)] lg:gap-14">
        <div>
          {STOPS.map((stop, i) => (
            <div key={stop.id}>
              {(i === 0 || STOPS[i - 1].act !== stop.act) && (
                <p className="text-muted-foreground border-border mt-8 border-t pt-8 font-mono text-xs tracking-[0.2em] uppercase first:mt-0 first:border-0 first:pt-0">
                  {ACT_LABELS[stop.act]}
                </p>
              )}
              <Panel register={register(i)}>
                <span className="text-primary/70 font-mono text-xs">
                  {String(i + 1).padStart(2, '0')} / {STOPS.length}
                </span>
                <h2 className="text-foreground mt-2 mb-0 font-serif text-2xl font-semibold text-balance">
                  {stop.heading}
                </h2>
                <p className="text-muted-foreground mt-3 text-base leading-relaxed text-pretty">
                  {stop.body}
                </p>
              </Panel>
            </div>
          ))}
        </div>

        {isDesktop && (
          <div>
            <div className="sticky top-[calc(var(--header-height)+2.5rem)] h-[min(80vh,640px)]">
              <Stage step={activeStep} />
            </div>
          </div>
        )}
      </div>

      <section className="border-border relative mt-16 border-t pt-12 pb-16">
        <h2 className="text-foreground m-0 font-serif text-2xl font-semibold">
          The short version
        </h2>
        <p className="text-muted-foreground mt-4 max-w-2xl text-base leading-relaxed text-pretty">
          {RECAP.shortVersion}
        </p>
        <p className="text-foreground mt-6 max-w-2xl border-l-2 border-primary pl-4 text-base leading-relaxed">
          {RECAP.trustLine}
        </p>
        <Button asChild className="mt-8">
          <Link to={RECAP.ctaTo}>{RECAP.ctaLabel}</Link>
        </Button>
      </section>
    </div>
  );
}

export default HowItWorks;
