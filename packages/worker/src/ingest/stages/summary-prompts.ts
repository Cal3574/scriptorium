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
