import { cn } from '@/lib/utils';

// A small gradient-dot pulse standing in for "Thinking..." while an AI reply
// is being generated (used wherever that copy already appears). Respects
// reduced-motion via the `.ai-thinking-dot` rule in index.css.
export function ThinkingDots({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex items-center gap-1', className)}
    >
      <span className="ai-thinking-dot" />
      <span className="ai-thinking-dot [animation-delay:0.15s]" />
      <span className="ai-thinking-dot [animation-delay:0.3s]" />
    </span>
  );
}
