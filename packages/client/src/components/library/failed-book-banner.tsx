import { useState } from 'react';
import { AlertTriangleIcon } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { failureHeadline, friendlyFailureLabel } from '@/books/failure';

// The plain-language failure callout for a book that stalled mid-pipeline
// (#54 inventory; user stories 29-32, 42). A shadcn `Alert` in the destructive
// variant: the headline names the failed step in plain language, the raw
// worker `failureReason` sits behind a disclosure for when the reader wants to
// dig in, and Retry re-enqueues the book. Whatever finished before the stall
// stays visible below this - the banner never hides partial results.
export function FailedBookBanner({
  failedStage,
  failureReason,
  onRetry,
}: {
  failedStage: string | null;
  failureReason: string | null;
  onRetry: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onRetry();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Alert variant="destructive" className="mb-6">
      <AlertTriangleIcon />
      <AlertTitle>{failureHeadline(failedStage)}</AlertTitle>
      <AlertDescription>
        <p>Everything we finished before it stopped is shown below.</p>
        {failureReason && (
          <details className="w-full">
            <summary className="text-muted-foreground cursor-pointer text-xs">
              Show details
            </summary>
            <p className="text-muted-foreground mt-1 font-mono text-xs break-words">
              {failureReason}
            </p>
          </details>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => void run()}
          disabled={busy}
        >
          {busy ? 'Retrying...' : `Retry ${friendlyFailureLabel(failedStage)}`}
        </Button>
        {error && (
          <span role="alert" className="text-status-failed text-xs">
            {error}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
