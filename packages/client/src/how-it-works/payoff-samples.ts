import { STOPS } from './stops';

// The two payoff stops (#83: "Real components at the payoff stops") render the
// app's real prose / answer / citation components fed this static sample
// content - no network, no new data contracts. Everything else on the page is
// the transforming visual; these two stops end each act on exactly what the
// reader will see in the product.

export function isPayoffStep(step: number): boolean {
  const id = STOPS[step]?.id;
  return id === 'book-summary' || id === 'answer';
}

export const SAMPLE_SUMMARY = `## What the book argues

Deep, undistracted work is a skill you build, not a mood you wait for. The
author sets it against *shallow work* - email, meetings, quick tasks - and
argues that the ability to focus without interruption is becoming both rarer
and more valuable.

## How to put it into practice

- Schedule focus blocks like appointments, and protect them.
- Make shallow work visible so it stops expanding to fill the day.
- Treat boredom as training, not as time to fill.`;

export const SAMPLE_ANSWER = `Both books treat focus as trainable rather than fixed. *Deep Work* frames it
as a professional skill you schedule and defend [1], while *Hyperfocus*
describes the same capacity as directing a limited pool of attention onto one
thing at a time [2]. They differ on distraction: one argues for removing it
from the environment [1], the other for noticing and redirecting it [2].`;

export const SAMPLE_CITATIONS = [
  {
    key: 'c1',
    marker: 1,
    bookTitle: 'Deep Work',
    chapterTitle: 'The Deep Work Hypothesis',
  },
  {
    key: 'c2',
    marker: 2,
    bookTitle: 'Hyperfocus',
    chapterTitle: 'Taming Distractions',
  },
];
