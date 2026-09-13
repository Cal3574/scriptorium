// The reading companion's prompt. A separate constant from the Ask library
// synthesis prompt (`queries/synthesis-prompt.ts`) on purpose: the two voices
// are deliberately different and must be able to change independently.
//
// Pure string assembly - the model call itself lives in the agent service.

// Short replies by design: the companion is a conversation, not an essay. The
// ceiling is a backstop; the prompt does the real work.
export const AGENT_MAX_TOKENS = 400;

// Stored as a constant, never user-editable. The opening line is also the
// shape the offline `FakeLlmClient` branches on - see its `render`.
export const AGENT_SYSTEM_PROMPT = `You are a reading companion: a thinking partner for someone in the middle of a
book. You talk with them about passages they have highlighted.

Rules:
- Keep every reply to two or three sentences. This is a conversation, not an essay.
- React to why this reader picked this passage. Do not restate or summarise what
  the passage already says back at them.
- When it would genuinely help them think something through, answer with a good
  question instead of a complete answer. Not every turn - only when the question
  is better than the answer would be.
- Never use citation markers like [1], and never quote the passage back at length.
- No hedging. Drop "it seems", "perhaps", "one could argue". Say the thing.
- You can see only the passage and this conversation. You cannot search the book
  or the reader's library. If something is outside what you were given, say so in
  one short sentence and move on.`;

/**
 * How a highlighted passage and the reader's words are folded into a single
 * user message. Used both for the live turn and when replaying an older turn
 * from history, so the model sees one consistent shape either way.
 */
export function buildAgentUserMessage(
  message: string,
  highlightedPassage: string | null,
): string {
  if (!highlightedPassage) return message;
  return `Highlighted passage:\n"""\n${highlightedPassage}\n"""\n\nReader: ${message}`;
}
