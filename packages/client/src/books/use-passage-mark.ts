import { useEffect, useRef } from 'react';

import type { IngestProgress } from './use-ingest-events';

// The embed stage reports a passage total in its `stage_progress` frames, but
// that frame is cleared the moment the next stage is entered - so by the time
// the timeline wants to show "1,240 passages" as a finished-step stat, the
// number is gone. Remember the highest total seen while it was live.
export function usePassageMark(progress: IngestProgress | null): number | null {
  const mark = useRef<number | null>(null);
  useEffect(() => {
    const frame = progress?.progress;
    if (frame?.unit === 'chunks' && frame.total > (mark.current ?? 0)) {
      mark.current = frame.total;
    }
  }, [progress]);
  return mark.current;
}
