// The synthesis prompt, verbatim from rag-query-spec 3.1-3.2. Pure string
// assembly - the model call itself lives in the query service.

import type { Candidate } from './select-chunks.js';

// rag-query-spec 3.2: `claude-sonnet-5`, `max_tokens: 1500`, no temperature
// override. The model id is the LlmClient adapter's default.
export const SYNTHESIS_MAX_TOKENS = 1500;

// Stored as a constant, never user-editable.
export const SYSTEM_PROMPT = `You are a research assistant for a personal library. You answer the reader's
question by synthesising ONLY the numbered excerpts provided. The excerpts are
passages retrieved from books the reader has uploaded.

Rules:
- Use only information found in the excerpts. Never add outside knowledge or
  speculation.
- Every substantive claim must cite its source excerpt(s) with a bracketed marker
  like [3], or [2][5] for multiple. The marker is the excerpt number.
- When the excerpts genuinely do not contain enough information to answer, say so
  plainly in one or two sentences and stop. Do not pad, do not guess, do not
  apologise at length.
- Prefer synthesis across books over summarising one excerpt at a time. Draw out
  agreements, tensions, and connections between authors when the excerpts support it.
- Answer in concise markdown. No preamble like "Based on the excerpts".`;

const LOW_CONFIDENCE_NOTE =
  'Note: retrieval returned weak matches for this question. If these excerpts ' +
  'do not actually address it, say the library does not seem to cover this.';

// `[n] {book_title} - {chapter_title}\n{chunk_text}`, blank line between.
function formatExcerpts(chunks: Candidate[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] ${c.bookTitle} - ${c.chapterTitle}\n${c.chunkText}`)
    .join('\n\n');
}

/**
 * The user message: `Question: {question}`, then - only when `lowConfidence` -
 * the weak-match note, then a blank line and the `Excerpts:` block. This shape
 * (label included) is the one the throwaway prototype validated against real
 * synthesis - see rag-query-spec 3.2.
 */
export function buildUserMessage(
  question: string,
  chunks: Candidate[],
  lowConfidence: boolean,
): string {
  const note = lowConfidence ? `\n${LOW_CONFIDENCE_NOTE}` : '';
  return `Question: ${question}${note}\n\nExcerpts:\n\n${formatExcerpts(chunks)}`;
}
