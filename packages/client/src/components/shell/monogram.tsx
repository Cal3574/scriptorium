import { cn } from '@/lib/utils';

// The Scriptorium mark: the slate rounded square from `favicon.svg`, with the
// "S" redrawn in Fraunces (via `currentColor` on a <text>) so it matches the
// app's serif rather than the favicon's Georgia fallback. Used in the top-bar
// wordmark and as the mobile-collapsed mark.
export function Monogram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('size-6', className)}
      role="img"
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="14" fill="var(--primary)" />
      <text
        x="32"
        y="34"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-serif)"
        fontSize="40"
        fontWeight="600"
        fill="var(--primary-foreground)"
      >
        S
      </text>
    </svg>
  );
}
