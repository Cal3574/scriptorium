import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';

import { Button } from '@/components/ui/button';
import { HERO, RECAP, STOPS } from './stops';
import { PinnedStage } from './PinnedStage';
import { useActiveStep } from './use-active-step';
import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

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

function Panel({
  register,
  children,
}: {
  register: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  const className =
    'flex min-h-[70vh] flex-col justify-center py-10 lg:min-h-screen';

  // Reduced motion (or no scripting): a plain section, end state, no gate.
  if (usePrefersReducedMotion()) {
    return (
      <section ref={register} className={className}>
        {children}
      </section>
    );
  }

  return (
    <motion.section
      ref={register}
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.5 }}
    >
      {children}
    </motion.section>
  );
}

// The stage is a deliberate dark "viewport into the machine" in both app
// themes - the `dark` scope makes its tokens and the 3-D palette resolve dark,
// so the glow reads and dark mode never flashes a light panel.
function Stage({ step }: { step: number }) {
  return (
    <div className="dark bg-background border-border relative h-full w-full overflow-hidden rounded-2xl border">
      <PinnedStage step={step} />
    </div>
  );
}

export function HowItWorks() {
  const { activeStep, register } = useActiveStep(STOPS.length);

  return (
    <div className="relative isolate -my-8 overflow-x-clip pt-8 pb-8">
      {/* Page-wide ambient glow, kept faint so light mode stays calm. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60vh] opacity-60 [background:radial-gradient(60%_60%_at_50%_0%,var(--primary),transparent_70%)] [mask-image:linear-gradient(black,transparent)]"
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
      <div className="bg-background/80 border-border/60 sticky top-(--header-height) z-10 -mx-4 mb-6 h-56 border-y px-3 py-3 backdrop-blur lg:hidden">
        <Stage step={activeStep} />
      </div>

      {/* Desktop: break out of the app's content column for a wide band. */}
      <div className="lg:relative lg:left-1/2 lg:w-screen lg:-translate-x-1/2">
        <div className="mx-auto max-w-[95rem] px-4 lg:px-8">
          <div className="lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16 xl:gap-24">
            <div>
              {STOPS.map((stop, i) => (
                <div key={stop.id}>
                  {(i === 0 || STOPS[i - 1].act !== stop.act) && (
                    <p className="text-muted-foreground border-border mt-6 border-t pt-6 font-mono text-xs tracking-[0.2em] uppercase first:mt-0 first:border-0 first:pt-0">
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

            <div className="hidden lg:block">
              <div className="sticky top-[calc(var(--header-height)+2.5rem)] h-[min(80vh,680px)]">
                <Stage step={activeStep} />
              </div>
            </div>
          </div>
        </div>
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
