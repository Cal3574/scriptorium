// The raw failure reason from the worker, shown full-width under a failed
// book row (#54). Mono, in the failed-red token. Renders nothing when the
// pipeline recorded no reason.
export function FailureReasonLine({ reason }: { reason: string | null }) {
  if (!reason) return null;

  return (
    <p className="text-status-failed col-span-full m-0 pt-1 font-mono text-xs">
      {reason}
    </p>
  );
}
