import { useEffect, useState } from 'react';
import {
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SparklesIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

// PROTOTYPE — throwaway, answers ticket #150 (cold-start / empty-state
// design for the AI reading companion widget, map #144). Mounted for real
// on top of the live app shell (see root-layout.tsx's `?proto150=1` gate)
// so it's judged against the real header/nav, not a blank page. Never
// merge past the `prototype/cold-start-150` branch — capture the winning
// copy/layout into the real widget when #150 resolves, then drop this file.
//
// v2: pass 1 read as generic empty-state UI, not "AI product" — this pass
// adds a rotating gradient glow ring (launcher + avatar), an animated
// gradient sheet edge, and shimmering gradient headline text so the widget
// reads as an AI surface at rest, not just idle chrome.
//
// Four cold-start SCENARIOS to react to (not layout variants of one screen
// — four genuinely different empty states the widget can be in). Cycle
// with the floating bar's arrows or ←/→.
type Scenario =
  | 'ask-empty'
  | 'agent-no-book'
  | 'agent-no-thread-reader'
  | 'agent-no-thread-elsewhere';

const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: 'ask-empty', label: 'Ask library — first open' },
  { key: 'agent-no-book', label: 'Agent — no book in context' },
  { key: 'agent-no-thread-reader', label: 'Agent — on reader, no thread yet' },
  {
    key: 'agent-no-thread-elsewhere',
    label: 'Agent — off reader, book in context, no thread',
  },
];

const MOCK_BOOK = 'Thinking, Fast and Slow';

// Scoped once; @property lets the conic-gradient angle itself be animated
// (rather than rotating the whole element, which would rotate blur/shadow
// with it) — that's what gives the ring its slow "alive" crawl instead of
// a static spinning pinwheel.
function GlowStyles() {
  return (
    <style>{`
      @property --ai-angle {
        syntax: '<angle>';
        inherits: false;
        initial-value: 0deg;
      }
      @keyframes ai-glow-spin {
        to { --ai-angle: 360deg; }
      }
      @keyframes ai-halo-pulse {
        0%, 100% { opacity: .55; transform: scale(1); }
        50% { opacity: .9; transform: scale(1.08); }
      }
      @keyframes ai-shimmer {
        to { background-position: 200% center; }
      }
      /* No position here on purpose — it would fight the Tailwind
         positioning utility (fixed/relative) each usage site needs;
         every usage site already establishes its own positioning
         context, which is all ::before/.ai-halo need to anchor to. */
      .ai-glow-ring {
        isolation: isolate;
      }
      .ai-glow-ring::before {
        content: '';
        position: absolute;
        inset: -3px;
        border-radius: inherit;
        z-index: -1;
        background: conic-gradient(
          from var(--ai-angle),
          var(--primary),
          #a78bfa,
          #7dd3fc,
          var(--primary)
        );
        animation: ai-glow-spin 4s linear infinite;
        filter: blur(7px);
      }
      .ai-halo {
        position: absolute;
        inset: -10px;
        border-radius: 9999px;
        background: radial-gradient(circle, var(--primary) 0%, transparent 70%);
        animation: ai-halo-pulse 2.6s ease-in-out infinite;
        z-index: -2;
      }
      .ai-shimmer-text {
        background: linear-gradient(
          90deg,
          var(--foreground) 0%,
          var(--foreground) 35%,
          #a78bfa 50%,
          var(--foreground) 65%,
          var(--foreground) 100%
        );
        background-size: 220% auto;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        animation: ai-shimmer 3.2s linear infinite;
      }
      .ai-sheet-edge {
        background: linear-gradient(
          90deg,
          var(--primary),
          #a78bfa,
          #7dd3fc,
          var(--primary)
        );
        background-size: 200% auto;
        animation: ai-shimmer 5s linear infinite;
      }
    `}</style>
  );
}

export function ChatWidgetColdStartPrototype() {
  const [open, setOpen] = useState(true);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const current = SCENARIOS[scenarioIndex] ?? SCENARIOS[0];
  const scenario = current.key;
  const tab: 'ask' | 'agent' = scenario === 'ask-empty' ? 'ask' : 'agent';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      if (e.key === 'ArrowLeft') {
        setScenarioIndex((i) => (i - 1 + SCENARIOS.length) % SCENARIOS.length);
      } else if (e.key === 'ArrowRight') {
        setScenarioIndex((i) => (i + 1) % SCENARIOS.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <GlowStyles />

      {/* Launcher — bottom-right icon per map #144, now with a slow-rotating
          gradient ring + breathing halo so it reads as "alive" at rest. */}
      <div className="ai-glow-ring fixed right-6 bottom-6 z-(--z-sheet) rounded-full">
        <div className="ai-halo" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="bg-primary text-primary-foreground relative flex size-12 items-center justify-center rounded-full shadow-lg hover:opacity-90"
          aria-label="Open chat"
        >
          <SparklesIcon className="size-5" />
        </button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="max-w-sm gap-0 p-0">
          <div className="ai-sheet-edge h-[3px] w-full shrink-0" />
          <div className="flex border-b">
            <div
              className={`flex-1 px-4 py-3 text-center text-sm font-medium transition-colors ${
                tab === 'ask'
                  ? 'border-primary text-foreground border-b-2'
                  : 'border-b-2 border-transparent text-muted-foreground'
              }`}
            >
              Ask library
            </div>
            <div
              className={`flex-1 px-4 py-3 text-center text-sm font-medium transition-colors ${
                tab === 'agent'
                  ? 'border-primary text-foreground border-b-2'
                  : 'border-b-2 border-transparent text-muted-foreground'
              }`}
            >
              Agent
            </div>
          </div>

          <div className="flex-1 p-6">
            {scenario === 'ask-empty' && <AskEmptyState />}
            {scenario === 'agent-no-book' && <AgentNoBookState />}
            {scenario === 'agent-no-thread-reader' && (
              <AgentNoThreadState onReader />
            )}
            {scenario === 'agent-no-thread-elsewhere' && (
              <AgentNoThreadState onReader={false} />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Prototype scenario switcher — not part of the design being judged */}
      <div className="fixed bottom-4 left-1/2 z-(--z-sheet) flex -translate-x-1/2 items-center gap-2 rounded-full border border-yellow-500 bg-yellow-100 px-3 py-1.5 text-xs font-medium text-yellow-900 shadow-lg">
        <button
          type="button"
          onClick={() =>
            setScenarioIndex(
              (i) => (i - 1 + SCENARIOS.length) % SCENARIOS.length,
            )
          }
          className="rounded p-0.5 hover:bg-yellow-200"
          aria-label="Previous scenario"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <span>
          {scenarioIndex + 1}/{SCENARIOS.length} — {current.label}
        </span>
        <button
          type="button"
          onClick={() => setScenarioIndex((i) => (i + 1) % SCENARIOS.length)}
          className="rounded p-0.5 hover:bg-yellow-200"
          aria-label="Next scenario"
        >
          <ChevronRightIcon className="size-4" />
        </button>
      </div>
    </>
  );
}

// Shared avatar: same glow-ring treatment as the launcher, scaled down, so
// the "AI" visual identity is consistent between closed and open widget.
function GlowAvatar() {
  return (
    <div className="ai-glow-ring relative mb-4 rounded-full">
      <div className="ai-halo" />
      <div className="bg-card relative flex size-12 items-center justify-center rounded-full">
        <SparklesIcon className="text-primary size-5" />
      </div>
    </div>
  );
}

function AskEmptyState() {
  return (
    <div>
      <SheetHeader className="mb-4 p-0">
        <SheetTitle className="ai-shimmer-text font-serif text-lg">
          Ask library
        </SheetTitle>
      </SheetHeader>
      <p className="text-muted-foreground mb-4 text-sm">
        Ask anything about the books in your library — I&apos;ll answer using
        passages from what you&apos;ve read.
      </p>
      <form>
        <Textarea
          rows={3}
          aria-label="question"
          placeholder="What do these authors say about..."
        />
        <Button type="submit" className="mt-3" disabled>
          Ask
        </Button>
      </form>
    </div>
  );
}

function AgentNoBookState() {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <GlowAvatar />
      <h3 className="ai-shimmer-text font-serif text-lg">
        Nothing to discuss yet
      </h3>
      <p className="text-muted-foreground mt-2 mb-5 max-w-[26ch] text-sm">
        Agent conversations start from something you highlight while reading.
        Open a book and select a passage to begin.
      </p>
      <Button variant="outline" size="sm">
        <BookOpenIcon className="size-4" />
        Go to Library
      </Button>
    </div>
  );
}

function AgentNoThreadState({ onReader }: { onReader: boolean }) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <GlowAvatar />
      <h3 className="ai-shimmer-text font-serif text-lg">{MOCK_BOOK}</h3>
      {onReader ? (
        <p className="text-muted-foreground mt-2 max-w-[28ch] text-sm">
          Select a passage on this page and choose &ldquo;Discuss with AI&rdquo;
          to start talking about it.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground mt-2 mb-5 max-w-[28ch] text-sm">
            You haven&apos;t started a conversation about this book yet.
            Highlight a passage while reading to begin.
          </p>
          <Button variant="outline" size="sm">
            <BookOpenIcon className="size-4" />
            Continue reading
          </Button>
        </>
      )}
    </div>
  );
}
