import {
  PdfExtractionError,
  type PdfExtractInput,
  type PdfExtraction,
  type PdfExtractor,
  type PdfHeadingItem,
  type PdfMetadata,
  type PdfOutlineItem,
  type PdfPage,
} from './pdf-extractor.js';
import { extractPdfOutline } from './pdfjs-outline.js';

// LlamaParse v2 REST. Per the integration research (#5) the worker owns its own
// job lifecycle, so this adapter calls the raw endpoints - submit on `upload`,
// poll `status`, then fetch `expand=markdown,items,metadata` - rather than the
// SDK's blocking auto-poll. `cost_effective` is the tier the chapter-detection
// prototype validated: clean markdown with `#`/`##` headings. `version` is
// required by the v2 API (pin to a dated version for reproducible parses;
// `latest` tracks their current stable release).
const BASE_URL = 'https://api.cloud.llamaindex.ai/api/v2';
const TIER = 'cost_effective';
const VERSION = 'latest';
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30 * 60_000;

// The v2 job-status enum, confirmed against the live API (their REST guide
// documents only PENDING/RUNNING/COMPLETED/FAILED/CANCELLED - no
// SUCCESS/PARTIAL_SUCCESS/ERROR as earlier drafts of this adapter assumed).
const TERMINAL_ERROR_STATUSES = new Set(['FAILED', 'CANCELLED']);

// A 429 is a rate limit (retry); other 4xx are our fault - a bad key, a
// malformed request - and will not fix themselves (terminal).
const isRetryableStatus = (status: number): boolean =>
  status === 429 || status >= 500;

export interface LlamaParseExtractorOptions {
  apiKey: string;
  /** Override for tests / self-hosted deployments. */
  baseUrl?: string;
}

// `POST /parse/upload` returns id/status flat at the top level.
interface LlamaParseUploadResponse {
  id: string;
  status: string;
}

// `GET /parse/{id}` nests the job fields under `job` - a different shape
// from the upload response above. Confirmed against the live API.
interface LlamaParseJobStatusResponse {
  job: {
    id: string;
    status: string;
    error_message?: string | null;
  };
}

// `GET /parse/{id}?expand=markdown,items,metadata` - each of the three
// expansions groups its content under its own `pages` array, keyed by
// `page_number`. Confirmed against the live API; the REST guide only
// describes these at a high level.
interface LlamaParseResult {
  markdown?: {
    pages?: Array<{ page_number?: number; markdown?: string }>;
  };
  items?: {
    pages?: Array<{
      page_number?: number;
      items?: Array<{
        type?: string;
        level?: number;
        value?: string;
      }>;
    }>;
  };
  metadata?: {
    document?: { title?: string; author?: string };
  };
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
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
    // The bookmark outline comes from a local `pdfjs-dist` pass over the same
    // bytes - LlamaParse does not expose it. Non-fatal: an empty outline just
    // means the detector leans on the markdown markers.
    const outline = await extractPdfOutline(input.data);
    return this.toExtraction(result, outline);
  }

  private async submit(
    input: PdfExtractInput,
  ): Promise<LlamaParseUploadResponse> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([Buffer.from(input.data)], { type: 'application/pdf' }),
      input.filename,
    );
    form.append(
      'configuration',
      JSON.stringify({ tier: TIER, version: VERSION }),
    );
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
    return (await res.json()) as LlamaParseUploadResponse;
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
      const { job } = (await res.json()) as LlamaParseJobStatusResponse;
      if (job.status === 'COMPLETED') return;
      if (TERMINAL_ERROR_STATUSES.has(job.status)) {
        throw new PdfExtractionError(
          `LlamaParse job ${jobId} ended in status ${job.status}${
            job.error_message ? `: ${job.error_message}` : ''
          }`,
          false,
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

  private toExtraction(
    result: LlamaParseResult,
    outline: PdfOutlineItem[],
  ): PdfExtraction {
    const rawPages = (result.markdown?.pages ?? [])
      .map((p, index) => ({
        page: p.page_number ?? index + 1,
        markdown: (p.markdown ?? '').trim(),
      }))
      .sort((a, b) => a.page - b.page);

    const rawMarkdown = rawPages.map((p) => p.markdown).join('\n\n');
    const markdown = rawMarkdown.trim() + '\n';

    const items: PdfHeadingItem[] = (result.items?.pages ?? [])
      .flatMap((p) =>
        (p.items ?? []).map((item) => ({ ...item, page: p.page_number ?? 1 })),
      )
      .filter((item) => item.type === 'heading')
      .map((item) => ({
        type: 'heading' as const,
        level: item.level ?? 1,
        text: (item.value ?? '').trim(),
        page: item.page,
      }))
      .filter((item) => item.text.length > 0);

    const pageCount = rawPages.length;

    // When LlamaParse gives no per-page split, fall back to the whole book as
    // one page so downstream page-range slicing still has something to read.
    const pages: PdfPage[] =
      rawPages.length > 0 ? rawPages : [{ page: 1, markdown }];

    const metadata: PdfMetadata = {
      title: cleanString(result.metadata?.document?.title),
      author: cleanString(result.metadata?.document?.author),
    };

    return { markdown, pages, items, outline, metadata, pageCount };
  }
}
