// The slice of process configuration the provider bindings need. Both
// `ApiConfig` and `WorkerConfig` from `@scriptorium/config` are structurally
// compatible with `EnvProviderConfig`, so callers pass their loaded config
// straight into `toProviderRuntimeConfig`.

export type ProviderMode = 'live' | 'fake';

export interface EnvProviderConfig {
  PROVIDER_MODE: ProviderMode;
  REDIS_URL: string;
  // The API's own public origin. Only the api process sets it; the fake object
  // storage uses it to build a presigned-PUT URL that points back at the
  // in-process dev upload route.
  API_URL?: string;
  LLAMAPARSE_API_KEY?: string;
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
  llamaparseApiKey?: string;
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
    llamaparseApiKey: env.LLAMAPARSE_API_KEY,
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
