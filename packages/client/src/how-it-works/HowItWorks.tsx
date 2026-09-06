import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';

import { Button } from '@/components/ui/button';
import { HERO, RECAP, STOPS } from './stops';
import { PinnedVisual } from './PinnedVisual';
import { useActiveStep } from './use-active-step';
import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

// The "How it works" page (#83): the whole pipeline as one continuous,
// scroll-driven journey. Short text panels move past a single pinned visual
// that transforms at each of eleven stops - a book becoming a summary, then a
// question becoming a cited answer. The account is concept-only (no vendor,
// model, or infrastructure names) so it stays correct when the internals
// change. Every panel's text and the payoff visuals are in the DOM without
// scrolling or animation, so the explanation survives reduced motion and
// disabled scripting; only the reveal and the visual's transitions are
// motion, and `motion` suppresses those under `prefers-reduced-motion`.

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

export function HowItWorks() {
  const { activeStep, register } = useActiveStep(STOPS.length);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="flex min-h-[50vh] flex-col justify-center py-16 text-center">
        <h1 className="text-foreground m-0 font-serif text-4xl leading-tight font-semibold sm:text-5xl">
          {HERO.title}
        </h1>
        <p className="text-muted-foreground mx-auto mt-4 max-w-xl text-lg">
          {HERO.promise}
        </p>
        <p className="text-muted-foreground mt-10 text-sm tracking-wide">
          {HERO.scrollCue}
          <span aria-hidden="true" className="mt-2 block text-lg">
            &darr;
          </span>
        </p>
      </header>

      {/* Mobile: the pinned visual as a sticky band under the top bar. */}
      <div className="bg-background/95 sticky top-(--header-height) z-10 -mx-4 mb-4 h-52 border-b border-border px-4 py-3 backdrop-blur lg:hidden">
        <PinnedVisual step={activeStep} />
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-16">
        <div>
          {STOPS.map((stop, i) => (
            <div key={stop.id}>
              {(i === 0 || STOPS[i - 1].act !== stop.act) && (
                <p className="text-muted-foreground border-border mt-6 border-t pt-6 font-mono text-xs tracking-widest uppercase first:mt-0 first:border-0 first:pt-0">
                  {ACT_LABELS[stop.act]}
                </p>
              )}
              <Panel register={register(i)}>
                <h2 className="text-foreground m-0 font-serif text-2xl font-semibold">
                  {stop.heading}
                </h2>
                <p className="text-muted-foreground mt-3 text-base leading-relaxed">
                  {stop.body}
                </p>
              </Panel>
            </div>
          ))}
        </div>

        {/* Desktop: the pinned visual, sticky beside the scrolling panels. */}
        <div className="hidden lg:block">
          <div className="sticky top-[calc(var(--header-height)+3rem)] h-[min(70vh,520px)]">
            <PinnedVisual step={activeStep} />
          </div>
        </div>
      </div>

      <section className="border-border mt-12 border-t pt-12 pb-16">
        <h2 className="text-foreground m-0 font-serif text-2xl font-semibold">
          The short version
        </h2>
        <p className="text-muted-foreground mt-4 max-w-2xl text-base leading-relaxed">
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
