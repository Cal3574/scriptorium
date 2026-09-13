import type { LlmClient, LlmRequest } from './llm-client.js';

const DEFAULT_DELAY_MS = 200;

const sleep = (ms: number): Promise<void> =>
  ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();

/**
 * Fault-injection sentinel. Any user message containing this string makes the
 * fake fail the way a real provider outage would - `complete` rejects, and
 * `stream` rejects on the first pull, before yielding anything. Integration
 * tests use it to exercise failure paths (an unanswered Agent turn, a failed
 * synthesis) end to end through the real app, with no per-test mocking.
 */
export const FAKE_LLM_FAILURE_MARKER = '__fake-llm-fail__';

export class FakeLlmFailure extends Error {
  constructor() {
    super('FakeLlmClient was asked to fail');
    this.name = 'FakeLlmFailure';
  }
}

interface Salient {
  bookTitle: string | null;
  heading: string | null;
  firstSentence: string | null;
  question: string | null;
  // The reader's own words on an Agent turn (the `Reader:` line).
  readerLine: string | null;
  // The highlight-to-discuss seed, unwrapped from its `"""` fences.
  highlightedPassage: string | null;
  citations: string[];
}

// Pull the handful of recognisable things out of the concatenated user text:
// the first `#` heading (treated as the book title), the first `##` heading,
// the first sentence of prose, and any `[n] Book - Chapter` citation lines the
// RAG synthesis prompt formats.
function extractSalient(request: LlmRequest): Salient {
  // The Agent shape replays history as alternating messages, so only the *last*
  // user message is the live turn - earlier ones are prior turns.
  const userMessages = request.messages.filter((m) => m.role === 'user');
  const text = userMessages.map((m) => m.content).join('\n');
  const latest = userMessages[userMessages.length - 1]?.content ?? '';

  let bookTitle: string | null = null;
  let heading: string | null = null;
  let question: string | null = null;
  const citations: string[] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const h1 = /^#\s+(.*\S)/.exec(line);
    if (h1 && bookTitle === null) bookTitle = h1[1];
    const h2 = /^##\s+(.*\S)/.exec(line);
    if (h2 && heading === null) heading = h2[1];
    const q = /^Question:\s*(.*\S)/i.exec(line);
    if (q && question === null) question = q[1];
    const cite = /^\[(\d{1,2})\]\s+(.*\S)/.exec(line);
    if (cite) citations.push(`[${cite[1]}] ${cite[2]}`);
  }

  // `Reader: ...` only appears when a highlighted passage was folded in; a
  // plain follow-up is the whole message.
  const readerMatch = /^Reader:\s*([\s\S]*\S)/m.exec(latest);
  const passageMatch = /Highlighted passage:\n"""\n([\s\S]*?)\n"""/.exec(
    latest,
  );
  const readerLine = readerMatch ? readerMatch[1] : latest.trim() || null;
  const highlightedPassage = passageMatch ? passageMatch[1].trim() : null;

  const prose = text
    .split('\n')
    .map((l) => l.trim())
    .find(
      (l) =>
        l.length > 0 &&
        !l.startsWith('#') &&
        !l.startsWith('[') &&
        !/^Question:/i.test(l),
    );
  const firstSentence = prose
    ? (/^(.*?[.!?])(\s|$)/.exec(prose)?.[1] ?? prose).slice(0, 200)
    : null;

  return {
    bookTitle,
    heading,
    firstSentence,
    question,
    readerLine,
    highlightedPassage,
    citations,
  };
}

// True when the request is a reading-companion turn. Branches on the system
// prompt rather than the user text, because an Agent message is freeform prose
// with no label of its own to recognise.
function isAgentRequest(request: LlmRequest): boolean {
  return /reading companion/i.test(request.system ?? '');
}

// How many completed turns were replayed as history ahead of the live one.
// Makes the fake's reply differ per turn, so a caller can tell that thread
// history actually reached the model.
function countPriorTurns(request: LlmRequest): number {
  return request.messages.filter((m) => m.role === 'assistant').length;
}

// True when any user message carries the fault-injection sentinel.
function shouldFail(request: LlmRequest): boolean {
  return request.messages.some(
    (m) => m.role === 'user' && m.content.includes(FAKE_LLM_FAILURE_MARKER),
  );
}

/**
 * Offline {@link LlmClient}. Returns templated markdown that visibly echoes the
 * salient parts of its input (book title, section heading, first sentence, and
 * the citation list for synthesis) so summaries differ per book and per chapter
 * and the query screen's citation rendering is exercised. Every call takes a
 * fixed artificial delay (default ~200ms) so SSE progress events are observable
 * rather than flashing past; pass `{ delayMs: 0 }` in tests.
 */
export class FakeLlmClient implements LlmClient {
  private readonly delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  }

  async complete(request: LlmRequest): Promise<string> {
    if (shouldFail(request)) throw new FakeLlmFailure();
    await sleep(this.delayMs);
    return this.render(request);
  }

  async *stream(
    request: LlmRequest,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    // Thrown on the first pull, before any delta - so a consumer that persists
    // only on completion is exercised as it would be by a real outage.
    if (shouldFail(request)) throw new FakeLlmFailure();
    const full = this.render(request);
    // Split into a handful of deltas on paragraph boundaries so consumers see
    // several `text_delta` events, matching a real token stream's shape.
    const parts = full.split(/(?<=\n\n)/);
    const perChunkDelay = this.delayMs / Math.max(parts.length, 1);
    for (const part of parts) {
      if (signal?.aborted) return;
      await sleep(perChunkDelay);
      yield part;
    }
  }

  private render(request: LlmRequest): string {
    const {
      bookTitle,
      heading,
      firstSentence,
      question,
      readerLine,
      highlightedPassage,
      citations,
    } = extractSalient(request);

    // Agent shape: a short Socratic reply in the companion's voice. Checked
    // first - an Agent message is freeform prose and could otherwise fall into
    // the synthesis branch. Deliberately two sentences, no `[n]` markers, and
    // it reacts to the reader rather than restating the passage, so a caller
    // asserting on the companion's contract has something real to assert.
    if (isAgentRequest(request)) {
      const turn = countPriorTurns(request);
      const asked = readerLine ?? 'that';
      const anchor = highlightedPassage
        ? 'the passage you pulled out'
        : 'where we left off';
      return [
        `You went to ${anchor} with "${asked}" - that says something about what you are really chasing.`,
        `What made that land for you rather than the line before it?`,
        turn > 0 ? `(turn ${turn + 1}, offline companion)` : '',
      ]
        .filter(Boolean)
        .join(' ');
    }

    // Identify-book shape: the stage asks for a strict JSON object. Echo the
    // book title parsed from the opening pages so the pipeline has a real
    // `{ title, author }` to persist offline.
    if (
      /JSON object/i.test(request.system ?? '') &&
      /title/i.test(request.system ?? '')
    ) {
      return JSON.stringify({
        title: bookTitle ?? heading ?? 'Untitled (offline)',
        author: null,
      });
    }

    if (citations.length > 0 || question) {
      // Synthesis shape: a short paragraph that echoes the question, plus the
      // citation list with `[n]` markers so the answer's marker post-parser
      // has real input. Every citation line is echoed verbatim.
      const markers = citations.map((_, i) => `[${i + 1}]`).join('');
      const bullets = citations.map((c) => `- ${c}`).join('\n');
      const asked = question ?? firstSentence ?? 'the question';
      return [
        `On "${asked}", the retrieved passages ${markers} broadly agree.`,
        '',
        citations.length > 0
          ? 'Passages consulted:'
          : 'No passages were retrieved.',
        bullets,
        '',
        '_Synthesised offline by FakeLlmClient._',
        '',
      ].join('\n');
    }

    // Summary shape (book summary, chapter deep dive, identify-book).
    return [
      `## ${heading ?? bookTitle ?? 'Summary'}`,
      '',
      `_Generated offline by FakeLlmClient for **${bookTitle ?? 'Untitled'}**._`,
      '',
      firstSentence
        ? `The section opens: "${firstSentence}"`
        : 'No prose was supplied to summarise.',
      '',
      `- Central point of "${heading ?? bookTitle ?? 'this section'}"`,
      '- A supporting observation echoing the source text',
      '- A closing implication for the reader',
      '',
    ].join('\n');
  }
}
