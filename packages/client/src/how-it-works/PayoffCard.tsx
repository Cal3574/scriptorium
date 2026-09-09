import { SummaryProse } from '@/components/prose/summary-prose';
import { AnswerBlock } from '@/components/query/answer-block';
import { CitationList } from '@/components/query/citation-list';
import { STOPS } from './stops';
import {
  SAMPLE_ANSWER,
  SAMPLE_CITATIONS,
  SAMPLE_SUMMARY,
} from './payoff-samples';

// The payoff stop: the real product component, floated on the same glow the
// 3D stage uses so the two acts land on-brand rather than snapping to a flat
// panel. `book-summary` shows the summary prose; `answer` shows the streamed
// answer treatment with its citation list.
export function PayoffCard({ step }: { step: number }) {
  const isSummary = STOPS[step]?.id === 'book-summary';

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-70 blur-3xl [background:radial-gradient(60%_50%_at_50%_45%,var(--primary),transparent_70%)]"
      />
      <div className="border-border/70 bg-card/80 max-h-full w-full max-w-md overflow-auto rounded-xl border p-5 shadow-sm backdrop-blur-md">
        {isSummary ? (
          <>
            <p className="text-muted-foreground mb-2 font-mono text-xs">
              Sample summary
            </p>
            <SummaryProse markdown={SAMPLE_SUMMARY} />
          </>
        ) : (
          <div className="space-y-4">
            <p className="text-muted-foreground font-mono text-xs">
              Sample answer
            </p>
            <AnswerBlock markdown={SAMPLE_ANSWER} streaming={false} />
            <div>
              <h2 className="text-foreground mb-2 font-serif text-base font-semibold">
                Citations
              </h2>
              <CitationList citations={SAMPLE_CITATIONS} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
