// The `failedStage` -> friendly-label mapping from the client-ingest-failure-ux
// spec. The server's `failedStage` is one of the internal pipeline stage names
// (`@scriptorium/contracts` `pipelineStages`); the UI never shows that raw
// token, only the plain-language phrase for what the pipeline was doing.
const STAGE_LABELS: Record<string, string> = {
  extract: 'reading the PDF',
  identifyBook: 'identifying the book',
  chunk: 'preparing the text',
  embed: 'building the search index',
  chapterSummary: 'summarizing the chapters',
  bookSummary: 'writing the overall summary',
};

// A sentence fragment naming the failed step, e.g. "reading the PDF". Falls
// back to a generic phrase for an unknown stage or a null (which should not
// happen for a `failed` book, but the DTO field is nullable).
export function friendlyFailureLabel(failedStage: string | null): string {
  if (!failedStage) return 'processing this book';
  return STAGE_LABELS[failedStage] ?? 'processing this book';
}

// The one-line headline for a failed book: "We couldn't finish reading the PDF."
export function failureHeadline(failedStage: string | null): string {
  return `We couldn't finish ${friendlyFailureLabel(failedStage)}.`;
}
