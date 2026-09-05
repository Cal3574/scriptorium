import type { BookStatus } from '@scriptorium/contracts';

// The eight `book_status` values collapse onto five visual roles for the
// Library worklist (#54). `queued` / `working` / `ready` / `failed` are the
// four chip colours; `deleting` is the disabled row that drops out once the
// SSE `book_deleted` event lands.
export type StatusRole = 'queued' | 'working' | 'ready' | 'failed' | 'deleting';

const ROLE_BY_STATUS: Record<BookStatus, StatusRole> = {
  pending: 'queued',
  extracting: 'working',
  chunking: 'working',
  embedding: 'working',
  summarizing: 'working',
  ready: 'ready',
  failed: 'failed',
  deleting: 'deleting',
};

export function statusRole(status: BookStatus): StatusRole {
  return ROLE_BY_STATUS[status] ?? 'queued';
}

// The friendly word shown in the chip (mono, upper-cased by the component).
export const ROLE_LABEL: Record<StatusRole, string> = {
  queued: 'queued',
  working: 'working',
  ready: 'ready',
  failed: 'failed',
  deleting: 'deleting',
};

// Plain-language phrase for the active pipeline stage, shown in the progress
// cell while a book is `working`. The raw `ProcessingStage` token is never
// surfaced. Falls back to a generic phrase for the queued state (stage null).
const STAGE_TEXT: Record<string, string> = {
  extracting: 'Reading the PDF',
  chunking: 'Preparing the text',
  embedding: 'Building the search index',
  summarizing: 'Writing summaries',
};

export function stageText(stage: string | null): string {
  if (!stage) return 'Queued';
  return STAGE_TEXT[stage] ?? 'Working';
}
