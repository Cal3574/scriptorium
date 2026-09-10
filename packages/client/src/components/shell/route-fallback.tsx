import { LoaderCircleIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

// The holding state shown before content is ready: while Clerk resolves the
// session (full page), and while a lazy provider remote is still in flight
// (`inline`, sitting in the screen's content column). A centred spinner on
// the app background rather than unstyled black text on white.
export function RouteFallback({
  label = 'Loading',
  inline = false,
}: {
  label?: string;
  inline?: boolean;
}) {
  return (
    <div
      role="status"
      className={cn(
        'text-muted-foreground flex items-center justify-center gap-2',
        inline ? 'py-10' : 'min-h-dvh',
      )}
    >
      <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
      <span className="font-mono text-xs">{label}</span>
    </div>
  );
}
