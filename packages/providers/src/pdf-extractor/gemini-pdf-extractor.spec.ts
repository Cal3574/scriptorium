import { PdfExtractionError } from './pdf-extractor.js';
import {
  GeminiPdfExtractor,
  type ExtractionPartialEvent,
  type GeminiContentClient,
} from './gemini-pdf-extractor.js';
import type { PdfStructure } from './pdfjs-outline.js';

// --- Fakes -----------------------------------------------------------------

interface GeminiResponse {
  text?: string;
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

const okResponse = (text: string): GeminiResponse => ({
  text,
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
});

const safetyBlock = (): GeminiResponse => ({
  text: '',
  candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
});

const sentinelBody = (
  pages: number[],
  body = (p: number) => `Body of page ${p}.`,
): string => pages.map((p) => `<!-- page ${p} -->\n${body(p)}`).join('\n');

// Pull the 1-based page list out of the adapter's own prompt text.
function requestedPages(request: unknown): number[] {
  const parts = (
    request as { contents: Array<{ parts: Array<{ text?: string }> }> }
  ).contents[0].parts;
  const prompt = parts.map((p) => p.text ?? '').join('');
  const match = /numbered ([\d, ]+)\./.exec(prompt);
  return (match?.[1] ?? '')
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n));
}

type Handler = (pages: number[], attempt: number) => GeminiResponse;

class FakeGemini implements GeminiContentClient {
  readonly requests: unknown[] = [];
  private readonly attemptsByKey = new Map<string, number>();

  constructor(private readonly handler: Handler) {}

  models = {
    generateContent: (request: unknown): Promise<GeminiResponse> => {
      this.requests.push(request);
      const pages = requestedPages(request);
      const key = pages.join(',');
      const attempt = (this.attemptsByKey.get(key) ?? 0) + 1;
      this.attemptsByKey.set(key, attempt);
      const result = this.handler(pages, attempt);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    },
  };
}

const structure: PdfStructure = {
  outline: [{ title: 'Chapter 1', page: 1, children: [] }],
  metadata: { title: 'Deep Modules', author: 'A. Author' },
  pageCount: 25,
};

const build = (
  handler: Handler,
  overrides: Partial<{
    emitEvent: (e: ExtractionPartialEvent) => void;
    pageCount: number;
  }> = {},
) => {
  const client = new FakeGemini((pages, attempt) => handler(pages, attempt));
  const extractor = new GeminiPdfExtractor({
    apiKey: 'test',
    pagesPerBatch: 10,
    batchConcurrency: 5,
    client,
    sleep: () => Promise.resolve(),
    readStructure: () =>
      Promise.resolve({
        ...structure,
        pageCount: overrides.pageCount ?? structure.pageCount,
      }),
    slicePdf: (_data, start, end) =>
      Promise.resolve(new Uint8Array([start, end])),
    emitEvent: overrides.emitEvent,
  });
  return { client, extractor };
};

const input = {
  data: new Uint8Array([1, 2, 3]),
  filename: 'book.pdf',
  bookId: 'book-1',
};

// --- Tests ---------------------------------------------------------------

describe('GeminiPdfExtractor', () => {
  it('assembles multiple batch responses into one PdfExtraction', async () => {
    const { extractor } = build((pages) =>
      okResponse(
        sentinelBody(pages, (p) =>
          p === 1 ? '# Deep Modules' : p === 11 ? '## Chapter 2' : `Body ${p}.`,
        ),
      ),
    );

    const result = await extractor.extract(input);

    expect(result.pages.map((p) => p.page)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(result.pages[10]).toEqual({ page: 11, markdown: '## Chapter 2' });
    expect(result.pageCount).toBe(25);
    expect(result.outline).toEqual(structure.outline);
    expect(result.metadata).toEqual(structure.metadata);
    expect(result.items).toEqual([
      { type: 'heading', level: 1, text: 'Deep Modules', page: 1 },
      { type: 'heading', level: 2, text: 'Chapter 2', page: 11 },
    ]);
    expect(result.markdown).toContain('# Deep Modules');
    expect(result.markdown.endsWith('\n')).toBe(true);
  });

  it('sets BLOCK_NONE on every safety category of every request', async () => {
    const { extractor, client } = build((pages) =>
      okResponse(sentinelBody(pages)),
    );
    await extractor.extract(input);

    expect(client.requests).toHaveLength(3);
    for (const request of client.requests) {
      const settings = (
        request as { config: { safetySettings: Array<{ threshold: string }> } }
      ).config.safetySettings;
      expect(settings).toHaveLength(4);
      expect(settings.every((s) => s.threshold === 'BLOCK_NONE')).toBe(true);
    }
  });

  it('retries a batch whose sentinels are malformed', async () => {
    const { extractor, client } = build((pages, attempt) => {
      if (pages[0] === 1 && attempt === 1) {
        return okResponse('<!-- page 1 -->\nonly one page');
      }
      return okResponse(sentinelBody(pages));
    });

    const result = await extractor.extract(input);
    expect(result.pages).toHaveLength(25);
    // 3 batches + 1 retry of the first.
    expect(client.requests).toHaveLength(4);
  });

  it('retries a batch that returns HTTP 429', async () => {
    const { extractor } = build((pages, attempt) => {
      if (pages[0] === 11 && attempt === 1)
        return Object.assign(new Error('rate limited'), {
          status: 429,
        }) as never;
      return okResponse(sentinelBody(pages));
    });

    const result = await extractor.extract(input);
    expect(result.pages).toHaveLength(25);
  });

  it('salvages a safety-blocked batch page-by-page and records a partial event', async () => {
    const events: ExtractionPartialEvent[] = [];
    const { extractor } = build(
      (pages) => {
        // The whole 11-20 batch blocks; page-by-page each page has one number.
        if (pages.length > 1 && pages[0] === 11) return safetyBlock();
        if (pages.length === 1 && pages[0] === 20) return safetyBlock();
        return okResponse(sentinelBody(pages));
      },
      { emitEvent: (e) => events.push(e) },
    );

    const result = await extractor.extract(input);

    expect(result.pages).toHaveLength(25);
    const page20 = result.pages.find((p) => p.page === 20);
    expect(page20?.markdown).toMatch(/transcription unavailable/);
    const page19 = result.pages.find((p) => p.page === 19);
    expect(page19?.markdown).toBe('Body of page 19.');
    expect(events).toEqual([
      { type: 'extraction.partial', bookId: 'book-1', unresolvedPageCount: 1 },
    ]);
  });

  it('salvages a safety block signalled only by a throwing `.text` getter', async () => {
    const events: ExtractionPartialEvent[] = [];
    const { extractor } = build(
      (pages) => {
        const blocked = pages.length > 1 && pages[0] === 11;
        if (!blocked) return okResponse(sentinelBody(pages));
        // Mirror the real SDK: no parts, finishReason SAFETY, and a `.text`
        // getter that throws rather than returning a string.
        const response: GeminiResponse = {
          candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
        };
        Object.defineProperty(response, 'text', {
          get() {
            throw new Error('cannot get text from a blocked candidate');
          },
        });
        return response;
      },
      { emitEvent: (e) => events.push(e) },
    );

    const result = await extractor.extract(input);
    expect(result.pages).toHaveLength(25);
    // Every page in 11-20 transcribed one at a time; none unresolved.
    expect(events).toEqual([]);
    expect(result.pages.find((p) => p.page === 15)?.markdown).toBe(
      'Body of page 15.',
    );
  });

  it('honours an API Retry-After over the computed backoff', async () => {
    const sleeps: number[] = [];
    const client = new FakeGemini((pages, attempt) => {
      if (pages[0] === 11 && attempt === 1) {
        return Object.assign(new Error('slow down'), {
          status: 429,
          retryAfter: 7,
        }) as never;
      }
      return okResponse(sentinelBody(pages));
    });
    const extractor = new GeminiPdfExtractor({
      apiKey: 'test',
      client,
      readStructure: () => Promise.resolve(structure),
      slicePdf: (_d, s, e) => Promise.resolve(new Uint8Array([s, e])),
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await extractor.extract(input);
    expect(sleeps).toEqual([7_000]);
  });

  it('fails the book non-retryably when a page range cannot be sliced', async () => {
    const extractor = new GeminiPdfExtractor({
      apiKey: 'test',
      client: new FakeGemini((pages) => okResponse(sentinelBody(pages))),
      readStructure: () => Promise.resolve(structure),
      slicePdf: () => Promise.reject(new Error('xref table broken')),
    });

    const error = await extractor.extract(input).catch((e) => e);
    expect(error).toBeInstanceOf(PdfExtractionError);
    expect((error as PdfExtractionError).retryable).toBe(false);
    expect((error as Error).message).toMatch(/Could not slice pages/);
  });

  it('throws non-retryable when Gemini returns HTTP 400', async () => {
    const { extractor } = build((pages) => {
      if (pages[0] === 11)
        return Object.assign(new Error('bad request'), {
          status: 400,
        }) as never;
      return okResponse(sentinelBody(pages));
    });

    const error = await extractor.extract(input).catch((e) => e);
    expect(error).toBeInstanceOf(PdfExtractionError);
    expect((error as PdfExtractionError).retryable).toBe(false);
    expect((error as Error).message).toContain('11-20');
  });

  it('throws non-retryable naming the page range when a batch exhausts its retries', async () => {
    const { extractor, client } = build((pages) => {
      if (pages[0] === 11)
        return Object.assign(new Error('unavailable'), {
          status: 503,
        }) as never;
      return okResponse(sentinelBody(pages));
    });

    const error = await extractor.extract(input).catch((e) => e);
    expect(error).toBeInstanceOf(PdfExtractionError);
    expect((error as PdfExtractionError).retryable).toBe(false);
    expect((error as Error).message).toMatch(/pages 11-20 after 3 attempts/);
    // The first batch ran once and was not re-run after the failure.
    const firstBatchCalls = client.requests.filter(
      (r) => requestedPages(r)[0] === 1,
    );
    expect(firstBatchCalls).toHaveLength(1);
  });

  it('fails the book non-retryably when the PDF structure cannot be read', async () => {
    const extractor = new GeminiPdfExtractor({
      apiKey: 'test',
      client: new FakeGemini(() => okResponse('')),
      readStructure: () => Promise.reject(new Error('not a PDF')),
      slicePdf: () => Promise.resolve(new Uint8Array()),
    });

    const error = await extractor.extract(input).catch((e) => e);
    expect(error).toBeInstanceOf(PdfExtractionError);
    expect((error as PdfExtractionError).retryable).toBe(false);
  });
});
