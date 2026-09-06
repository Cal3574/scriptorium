import { ArrowLeftIcon } from 'lucide-react';
import { Link } from 'react-router';

// The quiet "back to the parent list" link that sits above a detail screen's
// header (#54 inventory). A router `<Link>`, never a history callback, so it
// works from a deep link and the browser back button agrees with it. The
// label is the accessible name of the control - keep it a full phrase
// ("Back to library").
export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-xs font-medium no-underline transition-colors"
    >
      <ArrowLeftIcon className="size-3.5" />
      {children}
    </Link>
  );
}
