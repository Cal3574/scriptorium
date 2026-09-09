import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// The shared "nothing here yet" panel (#54): library with no books, history
// with nothing asked. A centred visual, a title, a line of guidance, and an
// optional call to action. `visual` overrides the plain `icon` when a screen
// wants something richer (the library previews an empty shelf).
export function EmptyState({
  icon: Icon,
  visual,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  visual?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border bg-card flex flex-col items-center gap-2 rounded-lg border px-6 py-16 text-center">
      {visual ??
        (Icon ? <Icon className="text-muted-foreground size-6" /> : null)}
      <p className="text-foreground font-serif text-lg">{title}</p>
      <p className="text-muted-foreground max-w-sm text-sm">{body}</p>
      {action ? <div className="mt-2 w-full max-w-sm">{action}</div> : null}
    </div>
  );
}
