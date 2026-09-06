import type { ReactNode } from 'react';

import { MEANING_SPACE_CAVEAT, STOPS } from './stops';
import { isPayoffStep } from './payoff-samples';
import { PayoffCard } from './PayoffCard';

// The flat, no-motion fallback for the pinned visual: shown whenever the 3D
// stage can't run - reduced motion, no WebGL, no scripting, or while the 3D
// chunk is still loading. Stops 1-6 and 8-10 are bespoke inline SVG in one
// visual language, themed through the design tokens so they work in light and
// dark; stops 7 and 11 defer to the real product components in `PayoffCard`.
// This is also the structural guarantee the tests lean on: every step's key
// visual is here without a canvas, a frame of animation, or a scroll.

const BOOK_COLOURS = ['var(--primary)', 'var(--status-progress)'];

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 240 200"
      role="img"
      aria-hidden="true"
      className="text-muted-foreground h-full max-h-[60vh] w-full"
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
        const lit = mode !== 'kept' || kept.has(p.id) ? 1 : 0.15;
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

export function FallbackVisual({ step }: { step: number }) {
  const id = STOPS[step]?.id;
  const showCaveat =
    id === 'meaning-space' || id === 'retrieve' || id === 'rerank';

  return (
    <figure className="relative m-0 flex h-full w-full flex-col items-center justify-center">
      <div className="flex w-full flex-1 items-center justify-center">
        {isPayoffStep(step) ? (
          <PayoffCard step={step} />
        ) : (
          <StepGraphic step={step} />
        )}
      </div>
      {showCaveat && (
        <figcaption className="text-muted-foreground mt-3 text-center text-xs">
          {MEANING_SPACE_CAVEAT}
        </figcaption>
      )}
    </figure>
  );
}
