import { GoogleGenAI } from '@google/genai';
import { mapWithConcurrency } from '../internal/map-with-concurrency.js';
import {
  PdfExtractionError,
  type PdfExtractInput,
  type PdfExtraction,
  type PdfExtractor,
  type PdfPage,
} from './pdf-extractor.js';
import { extractPdfStructure, type PdfStructure } from './pdfjs-outline.js';
import { classifyGeminiError } from './gemini/classify-error.js';
import { deriveHeadings } from './gemini/derive-headings.js';
import { parseSentinelPagesLenient } from './gemini/parse-sentinel-pages.js';
import {
  pagesInRange,
  slicePageRanges,
  type PageRange,
} from './gemini/slice-page-ranges.js';
import { slicePdfPages } from './gemini/slice-pdf-pages.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_PAGES_PER_BATCH = 10;
const DEFAULT_BATCH_CONCURRENCY = 5;
const BATCH_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

// Transcription needs no reasoning, so we want the thinking budget as low as the
// model allows. `gemini-2.5-flash-lite` accepts 0 (fully off); the 3.x lite
// models reject 0 with a 400 and enforce a small floor, so we pin the floor
// rather than 0. Still effectively no thinking - no `thoughtsTokenCount` comes
// back at this budget.
const MIN_THINKING_BUDGET = 128;

// The Flash-Lite models cap output at 65536 tokens; ask for all of it. A dense
// 10-page batch runs ~5k tokens, but code-heavy or tabular pages can blow past
// the model's (lower) default and get silently truncated mid-batch.
const MAX_OUTPUT_TOKENS = 65_536;

// Every configurable safety category, pinned to no-block. A literary book
// routinely trips these on quoted violence, sexual content, or slurs from
// primary sources; a transcription task is not the thing the filter is for.
const SAFETY_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
] as const;

// A `finishReason` that means "the model produced nothing because of the
// safety filter", as opposed to an API exception. Salvaged page-by-page.
const SAFETY_FINISH_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT']);

const prompt = (pageCount: number): string =>
  [
    'Transcribe every page of this PDF to GitHub-flavored Markdown.',
    'Preserve the reading order and all headings (use `#`..`######` for them).',
    'Do not summarise, comment, translate, or skip anything - transcribe verbatim.',
    `This PDF contains ${pageCount} page(s).`,
    "Immediately before each page's content, emit a sentinel line on its own:",
    '<!-- page K -->',
    'where K is the position of the page within THIS PDF, counting from 1 for',
    'its first page. Ignore any page number printed on the page itself - this',
    'PDF is an extract and its printed folios are not what K means.',
    `Emit exactly one sentinel per page, in order, from 1 to ${pageCount}.`,
    'Output only the sentinels and the transcription - no preamble.',
  ].join('\n');

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

// A `SAFETY` / `PROHIBITED_CONTENT` finish with no text. Distinct from an
// exception: it is caught inside the adapter and salvaged, never classified.
class SafetyBlockError extends Error {
  constructor(readonly pageRange: string) {
    super(`Gemini safety filter blocked pages ${pageRange}`);
    this.name = 'SafetyBlockError';
  }
}

interface GeminiResponse {
  text?: string;
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

// The one method the adapter uses, so a test can supply a fake without pulling
// in the SDK's response types.
export interface GeminiContentClient {
  models: {
    generateContent(request: unknown): Promise<GeminiResponse>;
  };
}

export interface ExtractionPartialEvent {
  type: 'extraction.partial';
  bookId: string | null;
  // Pages the safety filter refused even one-at-a-time; they carry a
  // placeholder in the markdown.
  unresolvedPageCount: number;
}

export interface GeminiPdfExtractorOptions {
  apiKey: string;
  model?: string;
  pagesPerBatch?: number;
  batchConcurrency?: number;
  // Seams for tests: a fake Gemini client, a fixed clock, and injectable
  // structural/slicing passes so an adapter spec needs no real PDF.
  client?: GeminiContentClient;
  sleep?: (ms: number) => Promise<void>;
  readStructure?: (data: Uint8Array) => Promise<PdfStructure>;
  slicePdf?: (
    data: Uint8Array,
    startPage: number,
    endPage: number,
  ) => Promise<Uint8Array>;
  // Sink for the structured `extraction.partial` event. Defaults to a no-op;
  // `selectProviderBindings` wires it to the process logger.
  emitEvent?: (event: ExtractionPartialEvent) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function responseText(response: GeminiResponse): string {
  const fromParts = (response.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('');
  if (fromParts.length > 0) return fromParts;
  // In the real `@google/genai` SDK `.text` is a getter that can throw on a
  // blocked candidate - never let that escape as an extraction error.
  try {
    return typeof response.text === 'string' ? response.text : '';
  } catch {
    return '';
  }
}

function rangeLabel(range: PageRange): string {
  return range.start === range.end
    ? `${range.start}`
    : `${range.start}-${range.end}`;
}

/**
 * A PDF text extractor backed by Google Gemini. A local `pdfjs-dist` pass
 * supplies the outline, metadata, and page count; the PDF is then sliced into
 * fixed-size page-range batches (`pdf-lib`), each sent to Gemini as native PDF
 * bytes and transcribed to markdown with slice-local `<!-- page K -->`
 * sentinels that the adapter maps back to absolute page numbers. Batches
 * run concurrently, are retried on transient failures, and safety-blocked
 * batches are salvaged page-by-page. Implements the same {@link PdfExtractor}
 * seam as {@link LlamaParseExtractor}, so everything downstream is unchanged.
 */
export class GeminiPdfExtractor implements PdfExtractor {
  private readonly model: string;
  private readonly pagesPerBatch: number;
  private readonly batchConcurrency: number;
  private readonly client: GeminiContentClient;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly readStructure: (data: Uint8Array) => Promise<PdfStructure>;
  private readonly slicePdf: (
    data: Uint8Array,
    startPage: number,
    endPage: number,
  ) => Promise<Uint8Array>;
  private readonly emitEvent: (event: ExtractionPartialEvent) => void;

  constructor(options: GeminiPdfExtractorOptions) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.pagesPerBatch = options.pagesPerBatch ?? DEFAULT_PAGES_PER_BATCH;
    this.batchConcurrency =
      options.batchConcurrency ?? DEFAULT_BATCH_CONCURRENCY;
    this.client =
      options.client ??
      (new GoogleGenAI({
        apiKey: options.apiKey,
      }) as unknown as GeminiContentClient);
    this.sleep = options.sleep ?? defaultSleep;
    this.readStructure = options.readStructure ?? extractPdfStructure;
    this.slicePdf = options.slicePdf ?? slicePdfPages;
    this.emitEvent = options.emitEvent ?? (() => undefined);
  }

  async extract(input: PdfExtractInput): Promise<PdfExtraction> {
    const structure = await this.readCanonicalStructure(input);
    const ranges = slicePageRanges(structure.pageCount, this.pagesPerBatch);

    const batches = await mapWithConcurrency(
      ranges,
      this.batchConcurrency,
      (range) => this.extractBatch(input, range),
    );

    const pages = batches
      .flat()
      .sort((a, b) => a.page - b.page)
      .map((page) => ({ page: page.page, markdown: page.markdown }));

    const unresolved = batches.flat().filter((page) => page.unresolved).length;
    if (unresolved > 0) {
      this.emitEvent({
        type: 'extraction.partial',
        bookId: input.bookId ?? null,
        unresolvedPageCount: unresolved,
      });
    }

    const markdown =
      pages
        .map((page) => page.markdown)
        .join('\n\n')
        .trim() + '\n';

    return {
      markdown,
      pages,
      items: deriveHeadings(pages),
      outline: structure.outline,
      metadata: structure.metadata,
      pageCount: structure.pageCount,
    };
  }

  private async readCanonicalStructure(
    input: PdfExtractInput,
  ): Promise<PdfStructure> {
    try {
      const structure = await this.readStructure(input.data);
      if (structure.pageCount < 1) {
        throw new Error('PDF reported zero pages');
      }
      return structure;
    } catch (error) {
      // A PDF we cannot even open the structure of is not going to transcribe;
      // fail the book rather than retry a hopeless job.
      throw new PdfExtractionError(
        `Could not read PDF structure for ${input.filename}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        false,
        { cause: error },
      );
    }
  }

  // Cut a page range out of the PDF. A failure here is deterministic (a
  // structurally broken PDF), so it is non-retryable - the outer `withRetry`
  // must not re-run the batches that already succeeded.
  private async slice(data: Uint8Array, range: PageRange): Promise<Uint8Array> {
    try {
      return await this.slicePdf(data, range.start, range.end);
    } catch (error) {
      throw new PdfExtractionError(
        `Could not slice pages ${rangeLabel(range)} from the PDF: ${
          error instanceof Error ? error.message : String(error)
        }`,
        false,
        { cause: error },
      );
    }
  }

  // One batch: slice, transcribe, retry transient failures, salvage a safety
  // block page-by-page. Returns the batch's pages in page order.
  private async extractBatch(
    input: PdfExtractInput,
    range: PageRange,
  ): Promise<SalvageablePage[]> {
    const slice = await this.slice(input.data, range);
    const expected = pagesInRange(range);

    try {
      const { pages, missing } = await this.transcribeWithRetry(
        slice,
        expected,
        range,
      );
      const salvaged =
        missing.length > 0
          ? await this.salvagePages(
              input,
              missing,
              'transcription unavailable (page dropped by the model)',
            )
          : [];
      return orderPages(
        [...pages.map((page) => ({ ...page, unresolved: false })), ...salvaged],
        expected,
      );
    } catch (error) {
      if (error instanceof SafetyBlockError) {
        return this.salvagePages(
          input,
          pagesInRange(range),
          'transcription unavailable (content filter)',
        );
      }
      throw error;
    }
  }

  private async transcribeWithRetry(
    slice: Uint8Array,
    expectedPages: number[],
    range: PageRange,
  ): Promise<TranscribeResult> {
    let lastError: unknown;
    let best: TranscribeResult | null = null;
    for (let attempt = 1; attempt <= BATCH_ATTEMPTS; attempt++) {
      try {
        const result = await this.transcribe(slice, expectedPages);
        if (result.missing.length === 0) return result;
        // A short-but-ordered response: the model dropped a page. Often
        // transient, so retry; keep the fullest attempt to fall back on.
        if (!best || result.pages.length > best.pages.length) best = result;
        lastError = new Error(
          `dropped pages ${result.missing.join(', ')} of ${rangeLabel(range)}`,
        );
      } catch (error) {
        lastError = error;
        if (error instanceof SafetyBlockError) throw error;
        if (classifyGeminiError(error) === 'terminal') {
          throw new PdfExtractionError(
            `Gemini rejected the batch for pages ${rangeLabel(range)}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            false,
            { cause: error },
          );
        }
      }
      if (attempt < BATCH_ATTEMPTS)
        await this.sleep(backoffMs(attempt, lastError));
    }
    // Retries exhausted. If we got a usable partial, hand it back so the batch
    // can salvage the missing pages one at a time; the whole book should not
    // fail over a couple of stubborn pages.
    if (best && best.pages.length > 0) return best;
    // Nothing usable. Surface it as non-retryable so `extractStage`'s outer
    // `withRetry` does not re-run the batches that already succeeded - only
    // whole-call setup failures are retryable.
    throw new PdfExtractionError(
      `Gemini extraction failed for pages ${rangeLabel(range)} after ${BATCH_ATTEMPTS} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      false,
      { cause: lastError },
    );
  }

  private async transcribe(
    slice: Uint8Array,
    expectedPages: number[],
  ): Promise<TranscribeResult> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64(slice),
              },
            },
            { text: prompt(expectedPages.length) },
          ],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: MIN_THINKING_BUDGET },
        safetySettings: SAFETY_CATEGORIES.map((category) => ({
          category,
          threshold: 'BLOCK_NONE',
        })),
      },
    });

    const text = responseText(response);
    const finishReason = response.candidates?.[0]?.finishReason;
    if (
      text.trim().length === 0 &&
      finishReason !== undefined &&
      SAFETY_FINISH_REASONS.has(finishReason)
    ) {
      throw new SafetyBlockError(
        rangeLabel({
          start: expectedPages[0],
          end: expectedPages[expectedPages.length - 1],
        }),
      );
    }

    return parseSentinelPagesLenient(text, expectedPages);
  }

  // Re-run a set of pages one at a time - used both for a safety-blocked batch
  // and for pages a batch response dropped. A page that transcribes on its own
  // is kept; one that still fails becomes a placeholder carrying `note` and
  // marks the extraction partial.
  private async salvagePages(
    input: PdfExtractInput,
    pageNumbers: number[],
    note: string,
  ): Promise<SalvageablePage[]> {
    const pages: SalvageablePage[] = [];
    for (const page of pageNumbers) {
      const single = { start: page, end: page };
      const slice = await this.slice(input.data, single);
      try {
        const { pages: transcribed } = await this.transcribeWithRetry(
          slice,
          [page],
          single,
        );
        if (transcribed.length > 0) {
          pages.push({
            page,
            markdown: transcribed[0].markdown,
            unresolved: false,
          });
          continue;
        }
        pages.push({
          page,
          markdown: `<!-- page ${page}: ${note} -->`,
          unresolved: true,
        });
      } catch (error) {
        if (
          !(error instanceof SafetyBlockError) &&
          !(error instanceof PdfExtractionError)
        ) {
          throw error;
        }
        pages.push({
          page,
          markdown: `<!-- page ${page}: ${note} -->`,
          unresolved: true,
        });
      }
    }
    return pages;
  }
}

interface TranscribeResult {
  pages: PdfPage[];
  missing: number[];
}

// Batch pages plus salvaged pages, back into the batch's page order.
function orderPages(
  pages: SalvageablePage[],
  expected: number[],
): SalvageablePage[] {
  const order = new Map(expected.map((page, index) => [page, index]));
  return [...pages].sort(
    (a, b) => (order.get(a.page) ?? 0) - (order.get(b.page) ?? 0),
  );
}

interface SalvageablePage extends PdfPage {
  unresolved: boolean;
}

function backoffMs(attempt: number, error: unknown): number {
  const retryAfter = readRetryAfterMs(error);
  if (retryAfter !== null) return retryAfter;
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
}

// The `Retry-After` the API asked us to wait, in ms, or null. `@google/genai`
// errors carry no headers today, so this reads a numeric `retryAfter` (seconds)
// or a `retry-after` entry on a `headers` bag, in case a wrapping layer adds
// one; the computed backoff is used otherwise.
function readRetryAfterMs(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as Record<string, unknown>;
  const headers = record.headers as Record<string, unknown> | undefined;
  const raw = record.retryAfter ?? headers?.['retry-after'];
  const seconds = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : null;
}
