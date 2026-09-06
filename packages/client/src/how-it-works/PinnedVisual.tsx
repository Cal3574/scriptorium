import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { SummaryProse } from '@/components/prose/summary-prose';
import { AnswerBlock } from '@/components/query/answer-block';
import { CitationList } from '@/components/query/citation-list';
import { MEANING_SPACE_CAVEAT, STOPS } from './stops';
import { usePrefersReducedMotion } from './use-prefers-reduced-motion';

// The single pinned visual: one book object transforming as the reader
// scrolls. `step` is the active stop index (0-10). Stops 1-6 and 8-10 are
// bespoke inline SVG in one visual language, themed through the design tokens
// so they work in light and dark. Stops 7 and 11 render the real product
// components fed static sample content - the journey ends on exactly what the
// reader sees in the app. Nothing here fetches or animates layout; the
// crossfade between states respects reduced-motion.

const BOOK_COLOURS = ['var(--primary)', 'var(--status-progress)'];

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 240 200"
      role="img"
      aria-hidden="true"
      className="text-muted-foreground h-full w-full"
      fill="none"
    >
      {children}
    </svg>
  );
}

function PageOutline({ lines = 6 }: { lines?: number }) {
  return (
    <>
      <rect
        x="70"
        y="30"
        width="100"
        height="140"
        rx="4"
        className="fill-card stroke-border"
        strokeWidth="1.5"
      />
      {Array.from({ length: lines }).map((_, i) => (
        <line
          key={i}
          x1="82"
          x2={i % 3 === 2 ? 132 : 158}
          y1={48 + i * 16}
          y2={48 + i * 16}
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          opacity={0.35}
        />
      ))}
    </>
  );
}

function ScatterField({ mode }: { mode: 'settled' | 'question' | 'kept' }) {
  // Deterministic pseudo-scatter in three loose clusters, tinted per book.
  const points = Array.from({ length: 42 }).map((_, i) => {
    const cluster = i % 3;
    const cx = [70, 150, 110][cluster] + ((i * 37) % 40) - 20;
    const cy = [60, 80, 150][cluster] + ((i * 53) % 40) - 20;
    const book = i % 5 === 0 || i % 7 === 0 ? 1 : 0;
    return { cx, cy, book, id: i };
  });
  const kept = new Set([1, 8, 15, 22, 29]);

  return (
    <>
      {points.map((p) => {
        const lit =
          mode !== 'kept' || kept.has(p.id) ? 1 : mode === 'kept' ? 0.15 : 1;
        return (
          <circle
            key={p.id}
            cx={p.cx}
            cy={p.cy}
            r={mode === 'kept' && kept.has(p.id) ? 4 : 3}
            fill={BOOK_COLOURS[p.book]}
            opacity={lit}
          />
        );
      })}
      {mode === 'question' && (
        <>
          <circle cx="112" cy="96" r="5" className="fill-foreground" />
          {points
            .filter((p) => Math.hypot(p.cx - 112, p.cy - 96) < 34)
            .map((p) => (
              <line
                key={`l-${p.id}`}
                x1="112"
                y1="96"
                x2={p.cx}
                y2={p.cy}
                stroke="currentColor"
                strokeWidth="1"
                opacity={0.5}
              />
            ))}
        </>
      )}
    </>
  );
}

function StepGraphic({ step }: { step: number }) {
  const id = STOPS[step]?.id;
  switch (id) {
    case 'upload':
      return (
        <Frame>
          <PageOutline />
          <path
            d="M120 12 v22 m-9 -11 l9 -11 l9 11"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text
            x="120"
            y="188"
            textAnchor="middle"
            className="fill-muted-foreground font-mono"
            fontSize="11"
          >
            book.pdf
          </text>
        </Frame>
      );
    case 'text':
      return (
        <Frame>
          <PageOutline lines={7} />
        </Frame>
      );
    case 'chapters':
      return (
        <Frame>
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x="60"
              y={34 + i * 44}
              width="120"
              height="34"
              rx="4"
              className="fill-card stroke-border"
              strokeWidth="1.5"
            />
          ))}
          {[0, 1, 2].map((i) => (
            <text
              key={i}
              x="72"
              y={55 + i * 44}
              className="fill-muted-foreground font-mono"
              fontSize="10"
            >
              Chapter {i + 1}
            </text>
          ))}
        </Frame>
      );
    case 'passages':
      return (
        <Frame>
          {Array.from({ length: 12 }).map((_, i) => (
            <rect
              key={i}
              x={54 + (i % 3) * 46}
              y={34 + Math.floor(i / 3) * 40}
              width="40"
              height="30"
              rx="3"
              className="fill-card stroke-border"
              strokeWidth="1.5"
              opacity={0.9}
            />
          ))}
        </Frame>
      );
    case 'meaning-space':
      return (
        <Frame>
          <ScatterField mode="settled" />
        </Frame>
      );
    case 'chapter-summaries':
      return (
        <Frame>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect
                x="54"
                y={30 + i * 46}
                width="34"
                height="34"
                rx="3"
                className="fill-card stroke-border"
                strokeWidth="1.5"
              />
              <path
                d={`M96 ${47 + i * 46} h18 m-6 -5 l6 5 l-6 5`}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {[0, 1, 2].map((l) => (
                <line
                  key={l}
                  x1="124"
                  x2={l === 2 ? 160 : 182}
                  y1={38 + i * 46 + l * 9}
                  y2={38 + i * 46 + l * 9}
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  opacity={0.35}
                />
              ))}
            </g>
          ))}
        </Frame>
      );
    case 'ask':
      return (
        <Frame>
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x={52 + i * 16}
              y={40 + i * 6}
              width="90"
              height="120"
              rx="4"
              className="fill-card stroke-border"
              strokeWidth="1.5"
            />
          ))}
          <rect
            x="60"
            y="150"
            width="150"
            height="26"
            rx="13"
            className="fill-muted stroke-border"
            strokeWidth="1.5"
          />
          <text
            x="74"
            y="167"
            className="fill-muted-foreground font-mono"
            fontSize="10"
          >
            Ask one question...
          </text>
        </Frame>
      );
    case 'retrieve':
      return (
        <Frame>
          <ScatterField mode="question" />
        </Frame>
      );
    case 'rerank':
      return (
        <Frame>
          <ScatterField mode="kept" />
        </Frame>
      );
    default:
      return (
        <Frame>
          <PageOutline />
        </Frame>
      );
  }
}

const SAMPLE_SUMMARY = `## What the book argues

Deep, undistracted work is a skill you build, not a mood you wait for. The
author sets it against *shallow work* - email, meetings, quick tasks - and
argues that the ability to focus without interruption is becoming both rarer
and more valuable.

## How to put it into practice

- Schedule focus blocks like appointments, and protect them.
- Make shallow work visible so it stops expanding to fill the day.
- Treat boredom as training, not as time to fill.`;

const SAMPLE_ANSWER = `Both books treat focus as trainable rather than fixed. *Deep Work* frames it
as a professional skill you schedule and defend [1], while *Hyperfocus*
describes the same capacity as directing a limited pool of attention onto one
thing at a time [2]. They differ on distraction: one argues for removing it
from the environment [1], the other for noticing and redirecting it [2].`;

const SAMPLE_CITATIONS = [
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

function Payoff({ step }: { step: number }) {
  if (STOPS[step]?.id === 'book-summary') {
    return (
      <div className="border-border bg-card max-h-full overflow-auto rounded-lg border p-5">
        <p className="text-muted-foreground mb-2 font-mono text-xs">
          Sample summary
        </p>
        <SummaryProse markdown={SAMPLE_SUMMARY} />
      </div>
    );
  }
  return (
    <div className="border-border bg-card max-h-full space-y-4 overflow-auto rounded-lg border p-5">
      <p className="text-muted-foreground font-mono text-xs">Sample answer</p>
      <AnswerBlock markdown={SAMPLE_ANSWER} streaming={false} />
      <div>
        <h2 className="text-foreground mb-2 font-serif text-base font-semibold">
          Citations
        </h2>
        <CitationList citations={SAMPLE_CITATIONS} />
      </div>
    </div>
  );
}

export function PinnedVisual({ step }: { step: number }) {
  const reduce = usePrefersReducedMotion();
  const id = STOPS[step]?.id;
  const isPayoff = id === 'book-summary' || id === 'answer';
  const showCaveat =
    id === 'meaning-space' || id === 'retrieve' || id === 'rerank';
  const body = isPayoff ? <Payoff step={step} /> : <StepGraphic step={step} />;

  return (
    <figure className="relative m-0 flex h-full w-full flex-col items-center justify-center">
      {reduce ? (
        <div className="flex w-full flex-1 items-center justify-center">
          {body}
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            className="flex w-full flex-1 items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {body}
          </motion.div>
        </AnimatePresence>
      )}
      {showCaveat && (
        <figcaption className="text-muted-foreground mt-3 text-center text-xs">
          {MEANING_SPACE_CAVEAT}
        </figcaption>
      )}
    </figure>
  );
}
