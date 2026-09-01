import { z } from 'zod';

// Every server process validates its environment exactly once, at startup,
// through one of the loaders below. A missing or malformed variable aborts
// the process with a non-zero exit code and the list of offending keys -
// there is no "run with a broken config" path.

// `PROVIDER_MODE` selects, all-or-nothing, whether the app binds the live
// external adapters (LlamaParse / OpenAI / Claude) or the offline fakes. It
// defaults to `live` - the only value used outside local dev, where `.env`
// sets `fake` explicitly. The three provider keys are required only in `live`
// mode, and ignored otherwise.
const providerKeys = [
  'LLAMAPARSE_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
] as const;

const sharedShape = {
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  PROVIDER_MODE: z.enum(['live', 'fake']).default('live'),
  LLAMAPARSE_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
};

// Attach to every process schema: in `live` mode each provider key must be a
// non-empty string, reported against its own key so the offending-keys list
// stays precise.
type MaybeProviderConfig = {
  PROVIDER_MODE?: string;
} & Partial<Record<(typeof providerKeys)[number], string>>;

function requireProviderKeysWhenLive(
  cfg: MaybeProviderConfig,
  ctx: z.RefinementCtx,
): void {
  if (cfg.PROVIDER_MODE !== 'live') return;
  for (const key of providerKeys) {
    if (!cfg[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when PROVIDER_MODE=live`,
      });
    }
  }
}

// Reader-upload storage keys. Required only in `live` mode - `fake` keeps
// uploads in an in-memory bucket. Reported against their own keys.
const s3Keys = [
  'S3_BUCKET',
  'S3_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

type MaybeS3Config = {
  PROVIDER_MODE?: string;
} & Partial<Record<(typeof s3Keys)[number], string>>;

function requireS3KeysWhenLive(cfg: MaybeS3Config, ctx: z.RefinementCtx): void {
  if (cfg.PROVIDER_MODE !== 'live') return;
  for (const key of s3Keys) {
    if (!cfg[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required when PROVIDER_MODE=live`,
      });
    }
  }
}

const apiConfigSchema = z
  .object({
    ...sharedShape,
    PORT: z.coerce.number().int().positive().default(3000),
    CLERK_SECRET_KEY: z.string().min(1),
    CLERK_PUBLISHABLE_KEY: z.string().min(1),
    // The PEM public key from the Clerk API-keys page. Enables networkless
    // (`verifyToken`) RSA verification in the auth guard - no JWKS fetch.
    CLERK_JWT_KEY: z.string().min(1),
    API_URL: z.string().url(),
    // The single browser origin allowed through CORS and accepted as the
    // token's `azp` (authorized party). Never `*`.
    CLIENT_ORIGIN: z.string().url(),
    // The reader-upload S3 bucket and the credentials that sign presigned
    // PUTs (see `docs/s3-setup.md`). Required only in `live` mode.
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    // Set for an S3-compatible endpoint (MinIO, LocalStack); omit for AWS.
    S3_ENDPOINT: z.string().url().optional(),
    AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
    AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    // The presigned-upload size ceiling the upload-url endpoint enforces.
    // Default 50 MiB.
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(50 * 1024 * 1024),
  })
  .superRefine(requireProviderKeysWhenLive)
  .superRefine(requireS3KeysWhenLive);

const workerConfigSchema = z
  .object({
    ...sharedShape,
    WORKER_PORT: z.coerce.number().int().positive().default(3001),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
    // The worker reads the original PDF back and writes the extracted-markdown
    // blob, so it needs the same S3 credentials as the api. Required only in
    // `live` mode; `fake` keeps objects in an in-memory bucket.
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_ENDPOINT: z.string().url().optional(),
    AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
    AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  })
  .superRefine(requireProviderKeysWhenLive)
  .superRefine(requireS3KeysWhenLive);

export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export class ConfigError extends Error {
  constructor(public readonly keys: string[]) {
    super(
      `Invalid environment configuration. Offending keys: ${keys.join(', ')}`,
    );
    this.name = 'ConfigError';
  }
}

// A shell that sources `.env` exports every listed key, so an unfilled line
// like `LLAMAPARSE_API_KEY=` arrives as `''` rather than absent. Treat an
// empty string as unset so `.optional()` and `.default()` behave the way the
// `.env.example` comments promise.
function stripEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== '') out[key] = value;
  }
  return out;
}

function parse<T>(schema: z.ZodType<T>, env: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(stripEmpty(env));
  if (result.success) return result.data;
  const keys = Array.from(
    new Set(
      result.error.issues.map((issue) => issue.path.join('.') || '(root)'),
    ),
  );
  throw new ConfigError(keys);
}

/**
 * Validate an environment against the api schema, throwing {@link ConfigError}
 * on failure. Prefer {@link loadApiConfig} at process start; this exists for
 * callers (tests, tooling) that want to handle the error themselves.
 */
export function parseApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  return parse(apiConfigSchema, env);
}

/** As {@link parseApiConfig}, for the worker schema. */
export function parseWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  return parse(workerConfigSchema, env);
}

function loadOnce<T>(
  current: T | undefined,
  parseFn: () => T,
  store: (value: T) => void,
): T {
  if (current !== undefined) return current;
  try {
    const value = parseFn();
    store(value);
    return value;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

let apiConfig: ApiConfig | undefined;
let workerConfig: WorkerConfig | undefined;

/**
 * Parse and cache the api process configuration. Call once at process start.
 * Exits the process with code 1 and the offending keys if validation fails.
 */
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return loadOnce(
    apiConfig,
    () => parseApiConfig(env),
    (value) => (apiConfig = value),
  );
}

/**
 * Parse and cache the worker process configuration. Call once at process
 * start. Exits the process with code 1 and the offending keys on failure.
 */
export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  return loadOnce(
    workerConfig,
    () => parseWorkerConfig(env),
    (value) => (workerConfig = value),
  );
}
