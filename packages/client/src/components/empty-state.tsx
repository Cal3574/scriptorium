import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// The shared "nothing here yet" panel (#54): library with no books, history
// with nothing asked. A centred icon, a title, a line of guidance, and an
// optional call to action.
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border bg-card flex flex-col items-center gap-2 rounded-lg border px-6 py-16 text-center">
      {Icon ? <Icon className="text-muted-foreground size-6" /> : null}
      <p className="text-foreground font-serif text-lg">{title}</p>
      <p className="text-muted-foreground max-w-sm text-sm">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
