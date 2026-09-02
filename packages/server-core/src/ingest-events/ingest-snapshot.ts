import {
  type BookStatus,
  type ProcessingStage,
  SnapshotEvent,
} from '@scriptorium/contracts';
import type { BookRow } from '../books/books.repository.js';

// The `book_status` -> active-stage projection the snapshot reports. The four
// terminal / not-yet-started statuses have no "current stage".
const STATUS_TO_STAGE: Record<BookStatus, ProcessingStage | null> = {
  pending: null,
  extracting: 'extracting',
  chunking: 'chunking',
  embedding: 'embedding',
  summarizing: 'summarizing',
  ready: null,
  failed: null,
  deleting: null,
};

export interface SnapshotInputs {
  book: BookRow;
  chaptersTotal: number;
  chaptersSummarized: number;
  seq: number;
}

/**
 * Build the `snapshot` frame that leads every SSE connection from the book's
 * database columns. `progress` is null until a long stage persists batch
 * progress; the client fills the in-stage bar from later `stage_progress`
 * deltas.
 */
export function buildIngestSnapshot(inputs: SnapshotInputs): SnapshotEvent {
  const { book } = inputs;
  return SnapshotEvent.parse({
    type: 'snapshot',
    bookId: book.id,
    seq: inputs.seq,
    status: book.status,
    stage: STATUS_TO_STAGE[book.status],
    progress: null,
    chaptersTotal: inputs.chaptersTotal,
    chaptersSummarized: inputs.chaptersSummarized,
    title: book.title,
    author: book.author,
    failedStage: book.failedStage,
    failureReason: book.failureReason,
  });
}
