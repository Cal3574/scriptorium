import type { ReactNode } from 'react';

// The heading block at the top of a screen's content column (#54 inventory):
// the display title set in Fraunces, with an optional slot on the right for
// status chrome (a live status line, a chip). Screen headings live in the
// column, never in the top bar.
export function ScreenHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h1 className="text-foreground m-0 font-serif text-2xl leading-tight font-semibold">
        {title}
      </h1>
      {children}
    </header>
  );
}
