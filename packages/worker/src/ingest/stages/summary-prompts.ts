// The two system prompts for the summary stages, verbatim from the
// chapter-detection & book-summary strategy spec (sections 2.3 and 2.4) and its
// validated prototype. Both demand markdown with a fixed shape and no preamble.

export const CHAPTER_SUMMARY_SYSTEM = [
  'You are writing a deep-dive summary of ONE chapter for a personal knowledge base.',
  "Output markdown: 2-3 sentence overview, then 4-8 key points with the author's reasoning,",
  'then any concrete practices/rules named. No preamble.',
].join(' ');

export const BOOK_SUMMARY_SYSTEM = [
  'You are summarising a non-fiction book for a personal knowledge base. Produce a tight',
  'high-level summary: 1-paragraph thesis, then 5-9 bullet key ideas, then 3-5 bullets on',
  'how the ideas connect. Markdown. No preamble.',
].join(' ');

// `max_tokens` for both calls, per the spec.
export const SUMMARY_MAX_TOKENS = 4000;

// The chapter deep-dive is the per-chapter fan-out - one call per chapter, so
// a 300-chapter book is 300 calls and the bulk of the ingest bill. Whole-
// chapter summarisation into a fixed markdown shape does not need Sonnet:
// route it to Haiku (roughly 1/2 the input price, 1/2 the output price) with
// no extended thinking (Haiku does no thinking unless asked, so the deep-dive
// pays only for the summary tokens). The whole-book reduce below stays on the
// adapter default (`claude-sonnet-5`) - it runs once per book and is where the
// cross-chapter synthesis quality matters.
export const CHAPTER_SUMMARY_MODEL = 'claude-haiku-4-5';
