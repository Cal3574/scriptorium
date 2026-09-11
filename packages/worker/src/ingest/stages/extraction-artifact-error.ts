import type { BookRow } from '@scriptorium/server-core';
import { TerminalIngestError } from '../errors.js';

// The sidecar reader (`requireExtractionArtifact`) lives in server-core and is
// error-type agnostic. In the worker a missing sidecar after `extract`
// completed is an unrecoverable pipeline invariant breach, so the `chunk` and
// `chapterSummary` stages hand it this factory - a `TerminalIngestError` the
// processor will not retry.
export function missingSidecarError(book: BookRow): TerminalIngestError {
  return new TerminalIngestError(
    `extraction sidecar is missing for book ${book.id}`,
  );
}
