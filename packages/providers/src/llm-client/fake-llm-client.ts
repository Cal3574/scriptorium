import type { LlmClient, LlmRequest } from './llm-client.js';

const DEFAULT_DELAY_MS = 200;

const sleep = (ms: number): Promise<void> =>
  ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();

interface Salient {
  bookTitle: string | null;
  heading: string | null;
  firstSentence: string | null;
  question: string | null;
  citations: string[];
}

// Pull the handful of recognisable things out of the concatenated user text:
// the first `#` heading (treated as the book title), the first `##` heading,
// the first sentence of prose, and any `[n] Book - Chapter` citation lines the
// RAG synthesis prompt formats.
function extractSalient(request: LlmRequest): Salient {
  const text = request.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');

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

  return { bookTitle, heading, firstSentence, question, citations };
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
    await sleep(this.delayMs);
    return this.render(request);
  }

  async *stream(request: LlmRequest): AsyncIterable<string> {
    const full = this.render(request);
    // Split into a handful of deltas on paragraph boundaries so consumers see
    // several `text_delta` events, matching a real token stream's shape.
    const parts = full.split(/(?<=\n\n)/);
    const perChunkDelay = this.delayMs / Math.max(parts.length, 1);
    for (const part of parts) {
      await sleep(perChunkDelay);
      yield part;
    }
  }

  private render(request: LlmRequest): string {
    const { bookTitle, heading, firstSentence, question, citations } =
      extractSalient(request);

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
