// The committed fixture book used by `FakePdfExtractor`. Inlined as a string
// module rather than a `.md` file read at runtime: the api and worker bundle
// `@scriptorium/providers` through webpack, which rewrites `__dirname` and does
// not copy loose asset files, so a `readFileSync` here fails in a built app.
// Real `#`/`##` headings and a handful of `chapter N` headings so chapter
// detection, chunking and summarisation all have honest input.

export const SAMPLE_BOOK_MARKDOWN = `# The Quiet Craft of Habit

## Introduction

Every life is a stack of small routines repeated until they become invisible.
This short book is a fixture: it exists so the Scriptorium pipeline has a real
book-shaped document to extract, chunk, embed, summarise, and cite while running
entirely offline. The chapters below are deliberately plain, but each carries a
clear heading and a few paragraphs of prose so that chapter detection, chunking,
and summarisation all have something honest to work with.

## Chapter 1. Starting Small

The hardest part of any habit is the first repetition, and the second. A change
that is too large to fail at once is also too large to start. The craftsman who
wants a daily practice begins with a version so small it feels almost
embarrassing: one sentence, one page, one deliberate breath. The size is not the
point. The return visit is the point. A tiny action performed today makes the
same action easier to reach for tomorrow, because the mind now recognises the
path.

## Chapter 2. The Shape of a Cue

Habits do not float free; they hang from cues. A place, a time, a preceding
action, an emotional weather front - any of these can become the hook that pulls
a behaviour into motion. When a routine keeps failing, the cue is usually the
missing piece rather than the willpower. Attach the new action to something that
already happens reliably, and the existing rhythm carries the new load.

## Chapter 3. Friction and Flow

Between intention and action sits friction: the number of steps, decisions, and
small frustrations that stand in the way. Good habits deserve low friction -
tools left in view, choices made in advance, obstacles cleared the night before.
Bad habits deserve the opposite. Add steps, hide the trigger, make the easy thing
slightly harder, and the pull weakens without any dramatic act of resistance.

## Chapter 4. Evidence of Identity

A repeated action is a small vote for a version of yourself. Each time the
craftsman writes, they cast a vote for being a writer; each skipped day is a vote
the other way. Over months the ballots accumulate into an identity that feels
simply true. This is why lasting change is less about outcomes and more about
becoming the kind of person for whom the outcome is natural.

## Chapter 5. The Plateau of Latent Potential

Progress rarely arrives on the schedule effort suggests. For a long stretch the
work seems to produce nothing, and then, apparently all at once, results appear.
The gains were accumulating the whole time below the surface. The person who
quits on the plateau never learns that they were one short season from the
breakthrough.

## Chapter 6. Systems Over Goals

Goals set a direction, but systems cover the distance. A goal is a single moment
of achievement; a system is the set of daily processes that make achievement a
by-product. Fall in love with the process and the results follow. Chase only the
result and the process feels like a tax you resent paying.

## Chapter 7. Keeping the Thread

No streak survives forever. The skill that matters is not perfection but recovery:
the ability to miss once and return without the missed day becoming a missed
month. Never miss twice. A single lapse is an accident; a second in a row is the
start of a new, unwanted habit.
`;
