// The slice of process configuration the provider bindings need. Both
// `ApiConfig` and `WorkerConfig` from `@scriptorium/config` are structurally
// compatible with `EnvProviderConfig`, so callers pass their loaded config
// straight into `toProviderRuntimeConfig`.

export type ProviderMode = 'live' | 'fake';
export type PdfExtractorChoice = 'gemini' | 'llamaparse';

export interface EnvProviderConfig {
  PROVIDER_MODE: ProviderMode;
  REDIS_URL: string;
  // The API's own public origin. Only the api process sets it; the fake object
  // storage uses it to build a presigned-PUT URL that points back at the
  // in-process dev upload route.
  API_URL?: string;
  // Which PDF text extractor the live bindings use. Defaults to `gemini`.
  PDF_EXTRACTOR?: PdfExtractorChoice;
  LLAMAPARSE_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_PAGES_PER_BATCH?: number;
  GEMINI_BATCH_CONCURRENCY?: number;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ENDPOINT?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
}

export interface ProviderRuntimeConfig {
  mode: ProviderMode;
  redisUrl: string;
  apiUrl?: string;
  pdfExtractor?: PdfExtractorChoice;
  llamaparseApiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  geminiPagesPerBatch?: number;
  geminiBatchConcurrency?: number;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
}

export function toProviderRuntimeConfig(
  env: EnvProviderConfig,
): ProviderRuntimeConfig {
  return {
    mode: env.PROVIDER_MODE,
    redisUrl: env.REDIS_URL,
    apiUrl: env.API_URL,
    pdfExtractor: env.PDF_EXTRACTOR,
    llamaparseApiKey: env.LLAMAPARSE_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    geminiPagesPerBatch: env.GEMINI_PAGES_PER_BATCH,
    geminiBatchConcurrency: env.GEMINI_BATCH_CONCURRENCY,
    openaiApiKey: env.OPENAI_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    s3Bucket: env.S3_BUCKET,
    s3Region: env.S3_REGION,
    s3Endpoint: env.S3_ENDPOINT,
    awsAccessKeyId: env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  };
}

// Defence in depth: `@scriptorium/config` already rejects a `live` config with
// a missing key, but `selectProviderBindings` can be called without that
// loader (tests, tooling), so the live factories re-check at construction with
// the same wording.
export function requireKey(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when PROVIDER_MODE=live`);
  }
  return value;
}
