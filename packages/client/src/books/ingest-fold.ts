import type {
  BookStatus,
  IngestEvent,
  ProcessingStage,
} from '@scriptorium/contracts';

// The live view of a book's ingest, folded from the SSE stream. Seeded by the
// `snapshot` frame, then advanced by each delta. Pure and env-free so it can
// be unit tested directly (mirrors `ingest-timeline.ts`); the hook in
// `use-ingest-events.ts` is the only production caller.
export interface IngestProgress {
  status: BookStatus;
  stage: ProcessingStage | null;
  progress: { done: number; total: number; unit: 'chunks' | 'chapters' } | null;
  chaptersTotal: number;
  chaptersSummarized: number;
  title: string | null;
  author: string | null;
  failedStage: string | null;
  failureReason: string | null;
}

// Advance the folded progress by one SSE event. A delta that arrives before
// the opening snapshot (`prev === null`) is a no-op.
export function fold(
  prev: IngestProgress | null,
  event: IngestEvent,
): IngestProgress | null {
  switch (event.type) {
    case 'snapshot':
      return {
        status: event.status,
        stage: event.stage,
        progress: event.progress,
        chaptersTotal: event.chaptersTotal,
        chaptersSummarized: event.chaptersSummarized,
        title: event.title,
        author: event.author,
        failedStage: event.failedStage,
        failureReason: event.failureReason,
      };
    case 'stage_entered':
      return (
        prev && {
          ...prev,
          stage: event.stage,
          status: event.status,
          progress: null,
        }
      );
    case 'stage_progress':
      return (
        prev && {
          ...prev,
          stage: event.stage,
          progress: { done: event.done, total: event.total, unit: event.unit },
          // The snapshot's chapter tally is a point-in-time value the stream
          // never revisits; keep it live off the chapter-unit frames so every
          // consumer (row cell and timeline) reads the same number.
          ...(event.unit === 'chapters' && {
            chaptersSummarized: event.done,
            chaptersTotal: event.total,
          }),
        }
      );
    case 'book_identified':
      return prev && { ...prev, title: event.title, author: event.author };
    case 'book_completed':
      return prev && { ...prev, status: 'ready', stage: null, progress: null };
    case 'book_failed':
      return (
        prev && {
          ...prev,
          status: 'failed',
          stage: null,
          failedStage: event.failedStage,
          failureReason: event.failureReason,
        }
      );
    case 'book_deleted':
      return prev && { ...prev, status: 'deleting' };
    default:
      return prev;
  }
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
