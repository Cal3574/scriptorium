import { stageText } from '@/books/status';
import { ProgressTrack } from '@/components/library/progress-track';
import type { IngestProgress } from '@/books/use-ingest-events';

// The live status line on BookDetail for a book still mid-pipeline (user story
// 43). Same source as the library row - the folded SSE progress - shown here
// as a single line: the plain-language stage phrase, the `done/total unit`
// figure in mono when the stage reports one, and the shared 3px
// `ProgressTrack` beneath. `data-connected` mirrors the SSE connection so a
// dropped stream is observable.
export function ProcessingStatus({
  progress,
  connected,
}: {
  progress: IngestProgress | null;
  connected: boolean;
}) {
  const counted = progress?.progress ?? null;

  return (
    <div
      role="status"
      data-connected={connected}
      className="border-border bg-card mb-6 rounded-lg border px-4 py-3"
    >
      <p className="text-muted-foreground m-0 font-mono text-xs">
        {stageText(progress?.stage ?? null)}
        {counted ? ` · ${counted.done}/${counted.total} ${counted.unit}` : ''}
      </p>
      <ProgressTrack
        value={
          counted && counted.total > 0
            ? counted.done / counted.total
            : undefined
        }
        indeterminate={!counted || counted.total === 0}
      />
    </div>
  );
}
