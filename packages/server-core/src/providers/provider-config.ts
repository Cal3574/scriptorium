// The slice of process configuration the provider bindings need. Both
// `ApiConfig` and `WorkerConfig` from `@scriptorium/config` are structurally
// compatible with `EnvProviderConfig`, so callers pass their loaded config
// straight into `toProviderRuntimeConfig`.

export type ProviderMode = 'live' | 'fake';

export interface EnvProviderConfig {
  PROVIDER_MODE: ProviderMode;
  REDIS_URL: string;
  LLAMAPARSE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

export interface ProviderRuntimeConfig {
  mode: ProviderMode;
  redisUrl: string;
  llamaparseApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

export function toProviderRuntimeConfig(
  env: EnvProviderConfig,
): ProviderRuntimeConfig {
  return {
    mode: env.PROVIDER_MODE,
    redisUrl: env.REDIS_URL,
    llamaparseApiKey: env.LLAMAPARSE_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
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
