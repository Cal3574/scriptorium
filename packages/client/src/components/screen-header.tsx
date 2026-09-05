import type { ReactNode } from 'react';

// The bar above a full-page worklist (#54): the screen name, an optional mono
// summary count, and an optional primary action pinned to the right. Panel
// background with the one ambient shadow. Shared by History and the Library
// toolbar so the two never drift.
export function ScreenHeader({
  title,
  summary,
  action,
}: {
  title: string;
  summary?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border bg-card mb-4 flex items-center gap-4 rounded-lg border px-4 py-3 shadow-xs">
      <h1 className="text-foreground m-0 text-sm font-semibold">{title}</h1>
      {summary ? (
        <span className="text-muted-foreground font-mono text-xs">
          {summary}
        </span>
      ) : null}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}
