import {
  PdfExtractionError,
  type PdfExtractInput,
  type PdfExtraction,
  type PdfExtractor,
  type PdfHeadingItem,
} from './pdf-extractor.js';

// LlamaParse v2 REST. Per the integration research (#5) the worker owns its own
// job lifecycle, so this adapter calls the raw endpoints - submit on `upload`,
// poll `status`, then fetch `expand=markdown,items,metadata` - rather than the
// SDK's blocking auto-poll. `cost_effective` is the tier the chapter-detection
// prototype validated: clean markdown with `#`/`##` headings.
const BASE_URL = 'https://api.cloud.llamaindex.ai/api/v2';
const TIER = 'cost_effective';
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30 * 60_000;

const TERMINAL_ERROR_STATUSES = new Set([
  'ERROR',
  'CANCELLED',
  'PDF_IS_BROKEN',
  'PDF_IS_PROTECTED',
]);

// A 429 is a rate limit (retry); other 4xx are our fault - a bad key, a
// malformed request - and will not fix themselves (terminal).
const isRetryableStatus = (status: number): boolean =>
  status === 429 || status >= 500;

export interface LlamaParseExtractorOptions {
  apiKey: string;
  /** Override for tests / self-hosted deployments. */
  baseUrl?: string;
}

interface LlamaParseJob {
  id: string;
  status: string;
}

interface LlamaParseResult {
  markdown?: string;
  pages?: Array<{ markdown?: string; page?: number }>;
  items?: Array<{
    type?: string;
    lvl?: number;
    level?: number;
    value?: string;
    content?: string;
    text?: string;
    page?: number;
    page_number?: number;
  }>;
  metadata?: { page_count?: number; num_pages?: number };
  job_metadata?: { page_count?: number };
}

export class LlamaParseExtractor implements PdfExtractor {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: LlamaParseExtractorOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? BASE_URL;
  }

  async extract(input: PdfExtractInput): Promise<PdfExtraction> {
    const job = await this.submit(input);
    await this.waitForCompletion(job.id);
    const result = await this.fetchResult(job.id);
    return this.toExtraction(result);
  }

  private async submit(input: PdfExtractInput): Promise<LlamaParseJob> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from(input.data)], { type: 'application/pdf' }),
      input.filename,
    );
    form.append('configuration', JSON.stringify({ tier: TIER }));
    const res = await fetch(`${this.baseUrl}/parse/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new PdfExtractionError(
        `LlamaParse upload failed: ${res.status} ${await res.text()}`,
        isRetryableStatus(res.status),
      );
    }
    return (await res.json()) as LlamaParseJob;
  }

  private async waitForCompletion(jobId: string): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      const res = await fetch(`${this.baseUrl}/parse/${jobId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) {
        throw new PdfExtractionError(
          `LlamaParse status check failed: ${res.status}`,
          isRetryableStatus(res.status),
        );
      }
      const { status } = (await res.json()) as LlamaParseJob;
      if (status === 'SUCCESS' || status === 'PARTIAL_SUCCESS') return;
      if (TERMINAL_ERROR_STATUSES.has(status)) {
        throw new PdfExtractionError(
          `LlamaParse job ${jobId} ended in status ${status}`,
          false,
        );
      }
      if (status === 'TIMEOUT') {
        throw new PdfExtractionError(
          `LlamaParse job ${jobId} ended in status ${status}`,
          true,
        );
      }
      if (Date.now() > deadline) {
        throw new PdfExtractionError(
          `LlamaParse job ${jobId} timed out after polling`,
          true,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  private async fetchResult(jobId: string): Promise<LlamaParseResult> {
    const res = await fetch(
      `${this.baseUrl}/parse/${jobId}?expand=markdown,items,metadata`,
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
    );
    if (!res.ok) {
      throw new PdfExtractionError(
        `LlamaParse result fetch failed: ${res.status}`,
        isRetryableStatus(res.status),
      );
    }
    return (await res.json()) as LlamaParseResult;
  }

  private toExtraction(result: LlamaParseResult): PdfExtraction {
    const rawMarkdown =
      result.markdown ??
      (result.pages ?? []).map((p) => p.markdown ?? '').join('\n\n');
    const markdown = rawMarkdown.trim() + '\n';

    const items: PdfHeadingItem[] = (result.items ?? [])
      .filter((item) => item.type === 'heading')
      .map((item) => ({
        type: 'heading' as const,
        level: item.lvl ?? item.level ?? 1,
        text: (item.value ?? item.content ?? item.text ?? '').trim(),
        page: item.page ?? item.page_number ?? 1,
      }))
      .filter((item) => item.text.length > 0);

    const pageCount =
      result.metadata?.page_count ??
      result.metadata?.num_pages ??
      result.job_metadata?.page_count ??
      result.pages?.length ??
      0;

    return { markdown, items, pageCount };
  }
}
