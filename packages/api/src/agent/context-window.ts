import type { LlmClient } from '@scriptorium/providers';
import type { AgentRepository, AgentThreadRow } from '@scriptorium/server-core';
import { buildAgentUserMessage } from './agent-prompt.js';
import { type CompletedTurn, groupCompletedTurns } from './thread-history.js';

// Message-count trigger: a thread is re-summarized once this many rows have
// landed since the last summarization boundary (or since thread creation, if
// it has never been summarized). Matches the repo's existing COUNT-based
// usage-tracking pattern (`AgentRepository.countMessagesThisMonth`) rather
// than a token budget - there is no token-counting utility in the repo, and
// Agent turns are short and capped, so a row count is a cheap, deterministic
// proxy for "this thread has grown long."
export const CONTEXT_TRIM_THRESHOLD = 40;

// How many of the most recent completed turns stay verbatim after a trim -
// everything older is folded into `runningSummary`. Re-crossing the trigger
// again requires this many further rows to land, since a trim always leaves
// exactly this much "unsummarized" behind.
export const CONTEXT_VERBATIM_TURNS = 10;

const SUMMARY_MAX_TOKENS = 400;

// Kept separate from `AGENT_SYSTEM_PROMPT` on purpose - this call never talks
// to the reader, it produces a string the *next* turn's prompt folds in.
const SUMMARY_SYSTEM_PROMPT = `You maintain a rolling summary of an ongoing conversation between a reader and
an AI conversation partner discussing a book passage.

Rules:
- Preserve the reader's specific reactions, questions, and opinions as concrete
  statements - do not flatten them into generic paraphrase.
- Do not summarise the book's content itself, only what was said in the
  conversation about it.
- If an earlier summary is given, merge it with the new turns into one updated
  summary - do not just append to it.
- Write plain prose, no headings or bullet points. Keep it as short as the
  material allows.`;

/**
 * After a turn has completed, folds any turns older than the verbatim window
 * into the thread's rolling summary, if the thread has crossed the trigger
 * threshold - a no-op below it, so a fresh or short thread pays nothing extra.
 *
 * Must only be called after the turn's own events have already been handed to
 * the SSE writer (see the call site in `AgentService.run`), so this work never
 * delays the reply the reader is waiting on.
 *
 * `signal` is the turn's own disconnect signal - checked once, immediately
 * before issuing the summarization call, so a reader who has already
 * disconnected (the common case: they closed the tab mid-reply, well before
 * this point) doesn't also pay for a summarization call nobody will use.
 * `LlmClient.complete()` has no signal parameter of its own, so a disconnect
 * *during* the call itself still runs to completion - an accepted gap, since
 * that call is both rare (only turns that cross the threshold) and short
 * (`SUMMARY_MAX_TOKENS`-bounded).
 */
export async function maybeTrimThread(
  llm: LlmClient,
  agent: AgentRepository,
  thread: AgentThreadRow,
  signal?: AbortSignal,
): Promise<void> {
  const unsummarizedCount = await agent.countMessagesSince(
    thread.id,
    thread.summarizedThroughSeq,
  );
  if (unsummarizedCount < CONTEXT_TRIM_THRESHOLD) return;

  const messages = await agent.listMessages(thread.id);
  const boundary = thread.summarizedThroughSeq;
  const unsummarized =
    boundary !== null ? messages.filter((m) => m.seq > boundary) : messages;

  // Grouped into turns (not raw rows) so the boundary this picks can never
  // land mid-turn - a prerequisite for `buildPromptHistory`'s verbatim filter
  // to stay adjacency-safe. Below-threshold-in-turns is a defensive no-op: the
  // row-count gate above can pass while a run of unanswered/failed rows keeps
  // the completed-turn count low.
  const turns = groupCompletedTurns(unsummarized);
  if (turns.length <= CONTEXT_VERBATIM_TURNS) return;

  if (signal?.aborted) return;

  const toFold = turns.slice(0, turns.length - CONTEXT_VERBATIM_TURNS);
  const summarizedThroughSeq = toFold[toFold.length - 1][1].seq;

  const summary = await llm.complete({
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: renderTurnsForSummary(thread.runningSummary, toFold),
      },
    ],
    maxTokens: SUMMARY_MAX_TOKENS,
  });

  await agent.updateSummary(thread.id, summary, summarizedThroughSeq);
}

function renderTurnsForSummary(
  previousSummary: string | null,
  turns: readonly CompletedTurn[],
): string {
  const transcript = turns
    .map(([user, assistant]) =>
      [
        `Reader: ${buildAgentUserMessage(user.message, user.highlightedPassage)}`,
        `Companion: ${assistant.message}`,
      ].join('\n'),
    )
    .join('\n\n');

  return previousSummary
    ? `Previous summary:\n${previousSummary}\n\nNew turns to fold in:\n${transcript}`
    : `Turns to summarise:\n${transcript}`;
}
