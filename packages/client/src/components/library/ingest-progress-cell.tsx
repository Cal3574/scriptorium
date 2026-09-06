import { friendlyFailureLabel } from '@/books/failure';
import { type StatusRole, stageText } from '@/books/status';
import { ProgressTrack } from './progress-track';

interface Progress {
  done: number;
  total: number;
  unit: string;
}

// The Progress column of a book row (#54). One cell, four shapes keyed by the
// visual role:
//   ready   -> `{pages}p · {chapters}ch`   (whichever figures are known)
//   working -> stage phrase + `{done}/{total} {unit}` + a 3px ProgressTrack
//   queued  -> the stage phrase alone ("Queued")
//   failed  -> `failed at: {friendly stage}`
// All figures are set in mono so data reads apart from prose.
export function IngestProgressCell({
  role,
  stage,
  progress,
  pageCount,
  chaptersTotal,
  failedStage,
}: {
  role: StatusRole;
  stage: string | null;
  progress: Progress | null;
  pageCount?: number | null;
  chaptersTotal?: number | null;
  failedStage?: string | null;
}) {
  if (role === 'failed') {
    return (
      <span className="text-status-failed font-mono text-xs">
        failed at: {friendlyFailureLabel(failedStage ?? null)}
      </span>
    );
  }

  if (role === 'ready') {
    const parts: string[] = [];
    if (pageCount != null) parts.push(`${pageCount}p`);
    if (chaptersTotal != null) parts.push(`${chaptersTotal}ch`);
    return (
      <span className="text-muted-foreground font-mono text-xs">
        {parts.length ? parts.join(' · ') : '-'}
      </span>
    );
  }

  if (role === 'working') {
    return (
      <span className="block">
        <span className="text-muted-foreground font-mono text-xs">
          {stageText(stage)}
          {progress
            ? ` · ${progress.done}/${progress.total} ${progress.unit}`
            : ''}
        </span>
        <ProgressTrack
          value={
            progress && progress.total > 0
              ? progress.done / progress.total
              : undefined
          }
          indeterminate={!progress || progress.total === 0}
        />
      </span>
    );
  }

  // queued / deleting
  return (
    <span className="text-muted-foreground font-mono text-xs">
      {role === 'deleting' ? 'Deleting' : stageText(stage)}
    </span>
  );
}
