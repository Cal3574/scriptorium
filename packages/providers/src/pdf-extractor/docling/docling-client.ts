import { PdfExtractionError } from '../pdf-extractor.js';
import type { DoclingDocument } from './docling-document.js';

// A thin wrapper over docling-serve's async REST API: submit a whole-book PDF
// as a background job, poll it to completion, then fetch the result. See
// https://github.com/docling-project/docling-serve/blob/main/docs/usage.md.
// docling-serve is self-hosted on a single VPS instance with no autoscaling,
// so the whole book is one job rather than fanned out into batches - there is
// nothing to fan out to.

type TaskStatus = 'pending' | 'started' | 'success' | 'failure';

interface PollResponse {
  task_status: TaskStatus;
}

interface ResultResponse {
  document?: { json_content?: DoclingDocument };
  status?: 'success' | 'partial_success' | 'skipped' | 'failure';
  errors?: Array<{ message?: string } | string>;
}

export interface DoclingClientOptions {
  baseUrl: string;
  documentTimeoutSeconds?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_DOCUMENT_TIMEOUT_SECONDS = 20 * 60;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
// Slack on top of `documentTimeoutSeconds` for polling/network overhead - the
// poll deadline must never be tighter than the server-side timeout it is
// polling for, or a book that legitimately needs the full configured budget
// gets client-side-timed-out before docling-serve itself gives up.
const POLL_TIMEOUT_BUFFER_MS = 5 * 60 * 1_000;

// A transient request (network blip, 429, 5xx) is retried in place a few
// times before giving up - especially important for a poll/result call after
// `submit` has already started a job on the single docling-serve VPS: giving
// up too eagerly would make the caller resubmit the whole book as a new job
// while the first one is still running server-side.
const REQUEST_ATTEMPTS = 5;
const REQUEST_BACKOFF_BASE_MS = 1_000;
const REQUEST_BACKOFF_MAX_MS = 30_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// 429 / 5xx / a network error are transient - worth retrying. Anything else
// (docling-serve rejected the request outright) is terminal.
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function backoffMs(attempt: number): number {
  return Math.min(REQUEST_BACKOFF_MAX_MS, REQUEST_BACKOFF_BASE_MS * 2 ** (attempt - 1));
}

async function errorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}

function resultErrorMessage(result: ResultResponse): string {
  const messages = (result.errors ?? []).map((error) =>
    typeof error === 'string' ? error : (error.message ?? JSON.stringify(error)),
  );
  return messages.length > 0 ? messages.join('; ') : 'docling reported a failure with no error detail';
}

/**
 * Drives one whole-PDF conversion through docling-serve's async endpoints:
 * `POST /v1/convert/file/async`, `GET /v1/status/poll/{task_id}`, `GET
 * /v1/result/{task_id}`. Requests `to_formats=json` only - `renderDocument`
 * derives everything else from the returned `DoclingDocument`.
 */
export class DoclingClient {
  private readonly baseUrl: string;
  private readonly documentTimeoutSeconds: number;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: DoclingClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.documentTimeoutSeconds =
      options.documentTimeoutSeconds ?? DEFAULT_DOCUMENT_TIMEOUT_SECONDS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollTimeoutMs =
      options.pollTimeoutMs ??
      this.documentTimeoutSeconds * 1_000 + POLL_TIMEOUT_BUFFER_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async convert(data: Uint8Array, filename: string): Promise<DoclingDocument> {
    const taskId = await this.submit(data, filename);
    await this.pollUntilDone(taskId);
    return this.fetchResult(taskId);
  }

  private async submit(data: Uint8Array, filename: string): Promise<string> {
    const form = new FormData();
    form.append(
      'files',
      new Blob([data], { type: 'application/pdf' }),
      filename,
    );
    form.append('to_formats', 'json');
    form.append('do_ocr', 'true');
    form.append('table_mode', 'accurate');
    form.append('document_timeout', String(this.documentTimeoutSeconds));

    const response = await this.request(
      `${this.baseUrl}/v1/convert/file/async`,
      { method: 'POST', body: form },
    );
    const body = (await response.json()) as { task_id: string };
    return body.task_id;
  }

  private async pollUntilDone(taskId: string): Promise<void> {
    const deadline = Date.now() + this.pollTimeoutMs;
    for (;;) {
      const response = await this.request(
        `${this.baseUrl}/v1/status/poll/${taskId}`,
      );
      const body = (await response.json()) as PollResponse;
      if (body.task_status === 'success' || body.task_status === 'failure') {
        return;
      }
      if (Date.now() >= deadline) {
        throw new PdfExtractionError(
          `docling conversion timed out after ${this.pollTimeoutMs}ms`,
          false,
        );
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private async fetchResult(taskId: string): Promise<DoclingDocument> {
    const response = await this.request(
      `${this.baseUrl}/v1/result/${taskId}`,
    );
    const body = (await response.json()) as ResultResponse;
    if (body.status === 'failure' || !body.document?.json_content) {
      throw new PdfExtractionError(
        `docling conversion failed: ${resultErrorMessage(body)}`,
        false,
      );
    }
    return body.document.json_content;
  }

  // Every docling-serve call goes through here so network errors and non-2xx
  // responses are classified into the same retryable/non-retryable split, and
  // a transient failure is retried in place rather than bubbling straight up
  // to `convert()` - see `REQUEST_ATTEMPTS`.
  private async request(url: string, init?: RequestInit): Promise<Response> {
    let lastError: PdfExtractionError | undefined;
    for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt++) {
      try {
        const response = await this.fetchImpl(url, init);
        if (response.ok) return response;
        const body = await errorBody(response);
        lastError = new PdfExtractionError(
          `docling-serve returned ${response.status} for ${url}: ${body}`,
          isRetryableStatus(response.status),
        );
      } catch (error) {
        lastError = new PdfExtractionError(
          `Could not reach docling-serve at ${url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          true,
          { cause: error },
        );
      }
      if (!lastError.retryable || attempt === REQUEST_ATTEMPTS) throw lastError;
      await this.sleep(backoffMs(attempt));
    }
    // Unreachable - the loop above always returns or throws.
    throw lastError as PdfExtractionError;
  }
}
