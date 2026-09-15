# Research: cheap-model grading rubric for free-text flashcard answers

Resolves #186 (child of map #183, "Wayfinder map: Scriptorium flashcards (topic-scoped recall)").

## Scope

This is research only, not a build spec.
It answers: what LLM call shape, which model tier, and what mitigations should the eventual grading job spec use to score a free-text flashcard answer 0-10 against a source passage, with short feedback, as a single non-agentic BullMQ worker call.

## 1. What already exists in this codebase

The provider abstraction lives in `packages/providers/src/llm-client`:

- `LlmClient` (`llm-client.ts`) is the seam - `complete()` for one-shot calls, `stream()` for token-by-token synthesis.
  A flashcard grading call is a `complete()` call: one request, one JSON reply, no streaming.
- `ClaudeLlmClient` (`claude-llm-client.ts`) is the only live adapter.
  It wraps `@anthropic-ai/sdk` (`^0.122.0`) directly - there is no vendor-neutral layer, no LangChain, no separate structured-output helper.
  Model and `max_tokens` are set per request via `LlmRequest.model` / `LlmRequest.maxTokens`, defaulting to `claude-sonnet-5` / 1500.
- `FakeLlmClient` (`fake-llm-client.ts`) is the offline adapter selected by `PROVIDER_MODE=fake`.
  It pattern-matches on the system prompt and user content to return a deterministic templated reply.
  A grading stage will need its own branch here (e.g. detect a system prompt mentioning "grade" / "flashcard" and a recognisable rubric marker) so `PROVIDER_MODE=fake` tests get a plausible `{score, feedback}` JSON body instead of falling through to another shape's branch.
- There is already a **cheap-model precedent**: `packages/worker/src/ingest/stages/summary-prompts.ts` routes the per-chapter summary fan-out to `claude-haiku-4-5` (`CHAPTER_SUMMARY_MODEL`) while the once-per-book reduce stays on the adapter default (`claude-sonnet-5`).
  The comment there ("Haiku does no thinking unless asked, so the deep-dive pays only for the summary tokens") is the right frame for grading too: this is a high-volume, low-complexity-per-call job, same shape as the chapter fan-out.
- There is already a **structured-output precedent**: `identify-book.stage.ts` asks for "a single minified JSON object and nothing else" in the system prompt, then does `raw.match(/\{[\s\S]*\}/)` followed by `JSON.parse` with a try/catch and safe fallback (`{title: null, author: null}` on any parse failure).
  No Anthropic tool-use / forced-schema mode is used anywhere in the codebase today - grading should follow the same prompt-for-JSON + regex-extract + fallback pattern for consistency, rather than introducing `tool_choice` forced-schema as a new pattern (see recommendation in §3).
- Retry: `withRetry()` (`packages/worker/src/ingest/retry.ts`) wraps the LLM call in `identifyBookStage`; grading should use the same helper rather than inventing new retry logic.
- Failure handling precedent: `identifyBookStage` treats an LLM failure as non-fatal (log + continue, keep the filename).
  Grading is user-facing (the reader is waiting on their score), so it should NOT silently continue past a failure the way `identifyBookStage` does - see §4 for the recommended fallback behaviour instead.

## 2. Recommended prompt structure

Single `complete()` call, no streaming, no multi-turn back-and-forth. Structure:

```
System:
  Role: "You are grading a reader's free-text answer to a flashcard, against the
  book passage it was written from."
  Rubric anchors (few-shot, inline - not JSON examples, just 3 short score/reason
  pairs at 0, 5, 10 on a *held-out* example passage/question, not the one being
  graded):
    - 0: answer is absent, off-topic, or contradicts the passage.
    - 5: answer captures the general idea but misses a specific fact/mechanism
      the passage states, or gets a material detail wrong.
    - 10: answer states the key claim(s) the passage supports, in the reader's
      own words; brevity is not penalised, verbosity is not rewarded.
  Explicit anti-gaming instructions:
    - "Grade on presence of the correct claim, not on length. A one-sentence
      correct answer scores the same as a five-sentence correct answer padded
      with restated context."
    - "If the answer lists multiple contradictory guesses, grade the *worst*
      guess, not the best one - do not give credit for covering all bases."
    - "Do not require the reader's exact wording or terminology from the
      passage; paraphrase that preserves the meaning is full credit."
  Output contract: "Respond with a single minified JSON object and nothing
  else: {"score": integer 0-10, "feedback": string}. feedback is one or two
  short sentences, addressed to the reader ('you'), naming what's missing or
  wrong - or, at score 10, what they got right. Do not restate the whole
  passage back."

User:
  Passage: """<source highlight text>"""
  Question: <flashcard front>
  Reference answer / key point (if the card was generated with one): <...>
  Reader's answer: """<free text>"""
```

Key design choices and why, tying back to the research in §3-4:

- **Anchor examples in the system prompt, not the user turn.** Keeps them out of the per-call variable content (so they can be prompt-cached across every grading call - same passage-independent prefix, cheap with Claude's prompt caching) and keeps the user turn to just the four variable fields.
- **JSON-only output, same shape as `identify-book.stage.ts`'s parse pattern**: `/\{[\s\S]*\}/` extraction, `JSON.parse`, `try/catch` with a defined fallback. No forced tool-use schema (see §3 for why not, given this codebase).
- **`temperature: 0`** (or as close to deterministic as the SDK allows) - this is a scoring task, not a creative one; low temperature is the single highest-leverage lever against run-to-run score drift on the same input.
- **No chain-of-thought exposed in the output.** Ask the model to reason, but only emit the final JSON - keeps the response short (cheap output tokens) and avoids a "show your work" field that users could see if `feedback` leaks it. If debugging needs the reasoning, add an internal-only `"rationale"` field to the JSON and never render it to the reader, rather than a separate call.
- **`maxTokens` small** (150-250) - score + two sentences of feedback does not need more, and a hard cap prevents a degenerate verbose reply from itself blowing the cost budget.

## 3. Model tier and cost

Given the vendor already wired in (`@anthropic-ai/sdk`, Claude), the realistic cheap tier is the same one already used for the ingest fan-out: **`claude-haiku-4-5`**.

- Pricing (Anthropic, as of Sep 2026): **$1 / 1M input tokens, $5 / 1M output tokens** for Haiku 4.5 - roughly 1/5 to 1/10 the cost of Sonnet depending on which Sonnet tier, consistent with the "roughly 1/2 the input price, 1/2 the output price" comment already in `summary-prompts.ts` relative to whatever Sonnet variant was current then (pricing moves; check current rates at spec time rather than trusting this doc's numbers as pinned).
- Rough cost per grading call: passage + question + reader answer is typically a few hundred tokens (a highlighted passage is a paragraph, not a chapter); system prompt with rubric anchors adds maybe 300-400 tokens, largely cacheable. Call it ~600-900 input tokens, ~60-100 output tokens per grade. At Haiku rates that is well under $0.001 per grading call - cheap enough that per-review-session cost is a non-issue even for a heavy user grading dozens of cards a day.
- **Do not use Sonnet for this.** Grading a short free-text answer against a short passage on a fixed rubric is exactly the "fixed-shape, low-complexity-per-call, high-volume" profile the codebase already routes to Haiku for chapter summaries. Reserve Sonnet-tier spend for the RAG synthesis and Agent chat paths where cross-document reasoning quality is load-bearing.
- **On structured output / tool-use forced schema**: Anthropic now supports a `structured-outputs` beta (forced JSON schema via `tool_choice`), but it is currently scoped to Sonnet 4.5 / Opus 4.1 class models, not confirmed for Haiku, and this codebase has no existing use of it. Given the existing `identify-book.stage.ts` precedent already handles "ask for JSON, regex-extract, parse, fall back safely" reliably in production, recommend **staying with that pattern** for v1 rather than taking on a new Anthropic beta header + model-tier constraint for marginal reliability gain on a very small, fixed JSON shape (`{score, feedback}` is far simpler than the multi-field cases structured-output betas are usually reached for).

## 4. Failure modes and mitigations (single-call, non-agentic)

| Failure mode                                                                                                                       | Why it happens                                                                                                         | Mitigation within one call                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hallucinated feedback** (feedback references facts not in the passage or not in the reader's answer)                             | Model fills in plausible-sounding detail when the passage is short/ambiguous or the answer is off-topic                | Instruct explicitly: "feedback must only reference content present in the passage or the reader's answer - do not introduce new facts." Keep `feedback` short (1-2 sentences) - shorter generations give the model less room to wander. If `PROVIDER_MODE=fake` tests are added, assert `feedback` length stays under the cap.                                                                                                                                                                                                                                                                                                                                                          |
| **Inconsistent scoring across repeated runs of the same answer** (score drift)                                                     | LLM judges are stochastic at temperature > 0; scale resolution (0-10) is finer than the model can reliably distinguish | Set `temperature: 0`. Consider collapsing to a coarser effective scale in the rubric anchors themselves (e.g. explicitly anchor only 0 / 5 / 10 as "wrong / partial / correct" and let the model interpolate 1-4 and 6-9 around those, rather than defining all 11 points) - research on LLM-as-judge scales consistently finds binary/coarse judgments align with humans far better than fine-grained ones. If exact reproducibility matters later, this is also where a second identical call + averaging (self-consistency) would go, but that doubles cost and is explicitly out of scope for a "single-call, non-agentic" job - flag as a possible v2 lever, not a v1 requirement. |
| **Over-crediting verbose-but-wrong answers** (padding, hedging, listing multiple contradictory guesses to increase odds one lands) | Judge models can be swayed by length/confidence cues unrelated to correctness                                          | Explicit anti-gaming instruction in the rubric (see §2): grade on presence of the correct claim, not length; grade the worst guess in a multi-guess answer, not the best. Cap `maxTokens` on the _reader's_ input size too (truncate absurdly long submissions before grading, with a UI-level answer length limit) so the job itself can't be used as a free-form essay-padding vector.                                                                                                                                                                                                                                                                                                |
| **Under-crediting terse-but-correct answers**                                                                                      | Judge models sometimes expect elaboration/justification the rubric didn't ask for                                      | Explicit rubric line: "brevity is not penalised" and "paraphrase that preserves meaning is full credit, exact wording is not required." Anchor the 10-score example on a genuinely short correct answer, not a long one, so the few-shot example itself doesn't bias toward verbosity.                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Malformed / non-JSON reply** (model adds preamble, breaks the schema)                                                            | Same class of failure `identify-book.stage.ts` already guards against                                                  | Reuse the regex-extract + `JSON.parse` + `try/catch` pattern; on failure, **do not silently drop the grade** (unlike `identifyBookStage`'s "log and continue") - retry once via `withRetry`, and if it still fails, surface a "grading unavailable, try again" state to the user rather than fabricating a 0 or guessing. A silent 0 on infra failure would look like a real grading failure to the reader, which is worse than an explicit retry/error state.                                                                                                                                                                                                                          |
| **Reference-passage/question mismatch or missing reference answer** (card generated without a strong key point)                    | Upstream flashcard-generation quality, not the grading prompt itself                                                   | Out of scope for this ticket, but note for the eventual spec: the grading prompt should tolerate `Reference answer` being absent (some cards may only have passage + question) and grade against the passage alone in that case - the prompt template above already treats it as optional.                                                                                                                                                                                                                                                                                                                                                                                              |

## 5. Recommendation summary

- Reuse `LlmClient.complete()` with `model: 'claude-haiku-4-5'`, `temperature: 0`, `maxTokens` ~150-250.
- System prompt: role + coarse 0/5/10 rubric anchors (on a held-out example, not the live one) + explicit anti-gaming rules (grade the worst of multiple guesses, brevity not penalised, no new facts in feedback) + strict "minified JSON only" output contract for `{score, feedback}`.
- Parse with the same regex-extract + `JSON.parse` + try/catch fallback pattern as `identify-book.stage.ts`; wrap the call in the existing `withRetry` helper.
- On parse failure after retry, surface an explicit "grading unavailable" state rather than defaulting to a score - do not follow `identifyBookStage`'s "log and continue" pattern here, since grading is user-facing and a silent wrong score is worse than a visible retry.
- Do not adopt Anthropic's forced-schema/tool-use structured output beta for this - the existing prompt-for-JSON pattern is proven in this codebase and sufficient for a two-field object.
- Add a `PROVIDER_MODE=fake` branch to `FakeLlmClient` recognising the grading system prompt, returning a deterministic `{score, feedback}` so offline tests can exercise the full grading path.

## Sources

- [LLM-as-a-Judge: How to Build Reliable, Scalable Evaluation for LLM Apps and Agents](https://www.comet.com/site/blog/llm-as-a-judge/)
- [LLM-Judge Prompt Engineering: The 2026 Engineering Guide](https://futureagi.com/blog/llm-judge-prompt-engineering-guide-2026/)
- [Rubric-Based Evaluations & LLM-as-a-Judge - Methodologies, Biases, and Empirical Validation in Domain-Specific Contexts](https://medium.com/@adnanmasood/rubric-based-evals-llm-as-a-judge-methodologies-and-empirical-validation-in-domain-context-71936b989e80)
- [LLM as a Judge prompts: templates, rubrics, and best practices - Galtea Blog](https://galtea.ai/blog/llm-as-a-judge-prompts-templates-rubrics-and-best-practices)
- [Structured outputs - Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Claude API Structured Output: Three Patterns for Guaranteed JSON](https://renezander.com/blog/claude-api-structured-output/)
- [Gaming the Answer Matcher: Examining the Impact of Text Manipulation on Automated Judgment](https://arxiv.org/html/2601.08849)
- [Rubric-Conditioned LLM Grading: Alignment, Uncertainty, and Robustness](https://arxiv.org/html/2601.08843)
- [When LLMs Over-Answer: Measuring and Mitigating Quality Issues in LLM-Based HDL QA](https://arxiv.org/html/2607.17063v2)
- [Claude API Pricing 2026: Opus 4.8, Sonnet 4.6, Haiku 4.5 Costs](https://www.metacto.com/blogs/anthropic-api-pricing-a-full-breakdown-of-costs-and-integration)
- [Anthropic API Pricing 2026: Complete Guide](https://www.finout.io/blog/anthropic-api-pricing)
