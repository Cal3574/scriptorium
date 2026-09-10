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

// Build a batch response with slice-local sentinels (`<!-- page 1 -->`..), the
// wire shape the adapter now asks for. `pages` is the absolute page list the
// batch covers; `drop` names absolute pages the model omitted entirely, leaving
// a gap in the local sequence exactly where that page sat.
const sentinelBody = (
  pages: number[],
  opts: { body?: (p: number) => string; drop?: number[] } = {},
): string => {
  const body = opts.body ?? ((p: number) => `Body of page ${p}.`);
  const drop = new Set(opts.drop ?? []);
  return pages
    .map((page, index) => ({ page, position: index + 1 }))
    .filter(({ page }) => !drop.has(page))
    .map(({ page, position }) => `<!-- page ${position} -->\n${body(page)}`)
    .join('\n');
};

// Recover the absolute page list a request covers from the PDF bytes it carries
// - the fake `slicePdf` encodes the range as `[start, end]`, so the adapter is
// never told the absolute numbers in the prompt.
function requestedPages(request: unknown): number[] {
  const parts = (
    request as {
      contents: Array<{ parts: Array<{ inlineData?: { data?: string } }> }>;
    }
  ).contents[0].parts;
  const data = parts.find((p) => p.inlineData)?.inlineData?.data ?? '';
  const [start, end] = [...Buffer.from(data, 'base64')];
  const pages: number[] = [];
  for (let page = start; page <= end; page++) pages.push(page);
  return pages;
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
        sentinelBody(pages, {
          body: (p) =>
            p === 1
              ? '# Deep Modules'
              : p === 11
                ? '## Chapter 2'
                : `Body ${p}.`,
        }),
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
        // A sentinel past the end of a 10-page slice: a scrambled response.
        return okResponse('<!-- page 99 -->\nscrambled');
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

  it('salvages a page the batch dropped, once retries do not recover it', async () => {
    const events: ExtractionPartialEvent[] = [];
    const { extractor, client } = build(
      (pages) => {
        // The 11-20 batch always omits page 17; a single-page call gets it.
        if (pages.length > 1 && pages[0] === 11) {
          return okResponse(sentinelBody(pages, { drop: [17] }));
        }
        return okResponse(sentinelBody(pages));
      },
      { emitEvent: (e) => events.push(e) },
    );

    const result = await extractor.extract(input);

    expect(result.pages).toHaveLength(25);
    expect(result.pages.map((p) => p.page)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(result.pages.find((p) => p.page === 17)?.markdown).toBe(
      'Body of page 17.',
    );
    // No unresolved pages, so no partial event.
    expect(events).toEqual([]);
    // 3 batches + 2 retries of 11-20 + 1 single-page call for 17.
    expect(client.requests).toHaveLength(6);
  });

  it('placeholders a dropped page that never transcribes and records it partial', async () => {
    const events: ExtractionPartialEvent[] = [];
    const { extractor } = build(
      (pages) => {
        if (pages.length > 1 && pages[0] === 11) {
          return okResponse(sentinelBody(pages, { drop: [17] }));
        }
        if (pages.length === 1 && pages[0] === 17) {
          return okResponse('nothing usable here');
        }
        return okResponse(sentinelBody(pages));
      },
      { emitEvent: (e) => events.push(e) },
    );

    const result = await extractor.extract(input);

    expect(result.pages).toHaveLength(25);
    expect(result.pages.find((p) => p.page === 17)?.markdown).toMatch(
      /transcription unavailable/,
    );
    expect(events).toEqual([
      { type: 'extraction.partial', bookId: 'book-1', unresolvedPageCount: 1 },
    ]);
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
