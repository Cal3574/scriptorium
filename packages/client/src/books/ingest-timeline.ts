import type { BookStatus, ProcessingStage } from '@scriptorium/contracts';

// The ingest pipeline as the reader sees it: five steps, folded from the live
// SSE progress (see `useIngestEvents`). The stream only names four coarse
// stages, so two boundaries are inferred - the "identified" beat from a title
// appearing, and the chapter/book-summary split from the chapter tally - and
// the opaque steps (`read`, `passages`, `book-summary`) simply run without a
// count. Pure: the component feeds it the folded progress plus the one
// high-water mark the stream forgets (the passage total, cleared on stage
// change).

export type TimelineRowId =
  'read' | 'passages' | 'embed' | 'chapters' | 'book-summary';

export type TimelineRowState = 'pending' | 'active' | 'done' | 'failed';

export interface TimelineDetail {
  done: number;
  total: number;
  unit: 'chunks' | 'chapters';
}

export interface TimelineRow {
  id: TimelineRowId;
  label: string;
  state: TimelineRowState;
  /** Live figure for an active counted step. */
  detail: TimelineDetail | null;
  /** Retained figure once the step is done, e.g. "18 chapters". */
  stat: string | null;
  /** Extra line under the label, e.g. the identified title. */
  subline: string | null;
}

export interface Timeline {
  rows: TimelineRow[];
  phase: 'queued' | 'running' | 'done' | 'failed';
}

export interface TimelineInput {
  status: BookStatus;
  stage: ProcessingStage | null;
  progress: TimelineDetail | null;
  chaptersTotal?: number | null;
  chaptersSummarized?: number | null;
  title?: string | null;
  author?: string | null;
  failedStage?: string | null;
  /** Highest passage total seen before the embed frame was cleared. */
  passagesTotalMark?: number | null;
}

const ROW_ORDER: readonly TimelineRowId[] = [
  'read',
  'passages',
  'embed',
  'chapters',
  'book-summary',
];

const LABEL: Record<TimelineRowId, string> = {
  read: 'Read the pages',
  passages: 'Cut into passages',
  embed: 'Build the meaning space',
  chapters: 'Summarize each chapter',
  'book-summary': 'Write the book summary',
};

// Internal pipeline stage -> the row it belongs to (for a `failed` book).
const FAILED_STAGE_ROW: Record<string, TimelineRowId> = {
  extract: 'read',
  identifyBook: 'read',
  chunk: 'passages',
  embed: 'embed',
  chapterSummary: 'chapters',
  bookSummary: 'book-summary',
};

// Coarse SSE stage -> the row it drives. Also covers a stranded-job failure,
// where the worker records `failedStage` as the raw `book_status`
// (`extracting` | `chunking` | ...) rather than a pipeline stage name.
const STAGE_ROW: Record<string, TimelineRowId> = {
  extracting: 'read',
  chunking: 'passages',
  embedding: 'embed',
  summarizing: 'chapters',
};

function identifiedSubline(
  title?: string | null,
  author?: string | null,
): string | null {
  if (!title) return null;
  return author ? `Identified: ${title} - ${author}` : `Identified: ${title}`;
}

export function buildTimeline(input: TimelineInput): Timeline {
  const subline = { read: identifiedSubline(input.title, input.author) };

  const row = (
    id: TimelineRowId,
    state: TimelineRowState,
    extra: Partial<TimelineRow> = {},
  ): TimelineRow => ({
    id,
    label: LABEL[id],
    state,
    detail: null,
    stat: null,
    subline: id === 'read' ? subline.read : null,
    ...extra,
  });

  if (input.status === 'failed') {
    const failedRow: TimelineRowId =
      (input.failedStage ? FAILED_STAGE_ROW[input.failedStage] : undefined) ??
      (input.failedStage ? STAGE_ROW[input.failedStage] : undefined) ??
      (input.stage ? STAGE_ROW[input.stage] : undefined) ??
      'read';
    const failedAt = ROW_ORDER.indexOf(failedRow);
    return {
      phase: 'failed',
      rows: ROW_ORDER.map((id, i) =>
        row(id, i < failedAt ? 'done' : i === failedAt ? 'failed' : 'pending'),
      ),
    };
  }

  if (input.status === 'ready') {
    return { phase: 'done', rows: ROW_ORDER.map((id) => row(id, 'done')) };
  }

  if (input.stage == null) {
    return { phase: 'queued', rows: ROW_ORDER.map((id) => row(id, 'pending')) };
  }

  // Chapter tally: the snapshot fields when present, else the transient
  // progress frame while `summarizing`.
  const chapProgress =
    input.progress?.unit === 'chapters' ? input.progress : null;
  const chaptersDone = input.chaptersSummarized ?? chapProgress?.done ?? 0;
  const chaptersTotal = input.chaptersTotal || chapProgress?.total || 0;
  const chaptersAllDone = chaptersTotal > 0 && chaptersDone >= chaptersTotal;

  // The index of the row currently being worked.
  let activeRow: TimelineRowId = STAGE_ROW[input.stage];
  if (input.stage === 'summarizing' && chaptersAllDone) {
    activeRow = 'book-summary';
  }
  const activeAt = ROW_ORDER.indexOf(activeRow);

  const rows = ROW_ORDER.map((id, i) => {
    if (i < activeAt) {
      const extra: Partial<TimelineRow> = {};
      if (id === 'embed' && input.passagesTotalMark) {
        extra.stat = `${input.passagesTotalMark.toLocaleString()} passages`;
      }
      if (id === 'chapters' && chaptersTotal > 0) {
        extra.stat = `${chaptersTotal} chapters`;
      }
      return row(id, 'done', extra);
    }
    if (i > activeAt) return row(id, 'pending');

    // The active row.
    const extra: Partial<TimelineRow> = {};
    if (id === 'embed' && input.progress?.unit === 'chunks') {
      extra.detail = input.progress;
    }
    if (id === 'chapters') {
      extra.detail = {
        done: chaptersDone,
        total: chaptersTotal,
        unit: 'chapters',
      };
    }
    return row(id, 'active', extra);
  });

  return { phase: 'running', rows };
}
