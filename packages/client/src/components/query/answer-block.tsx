import { SummaryProse } from '@/components/prose/summary-prose';

// The streamed answer (#54 inventory; user stories 46-48). The markdown so far
// goes through the shared `SummaryProse` treatment so a half-written answer
// reads exactly like a finished one. While `streaming` is true a thin caret
// blinks at the end of the text as the "still being written" cue; it is gone
// the moment the `done` event lands. The caret respects reduced-motion.
export function AnswerBlock({
  markdown,
  streaming,
}: {
  markdown: string;
  streaming: boolean;
}) {
  return (
    <div data-answer data-streaming={streaming || undefined}>
      <SummaryProse markdown={markdown} />
      {streaming && (
        <span
          data-testid="answer-caret"
          aria-hidden="true"
          className="bg-foreground/70 -mt-1 ml-0.5 inline-block h-4 w-[2px] align-text-bottom motion-safe:animate-caret-blink"
        />
      )}
    </div>
  );
}
