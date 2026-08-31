import { z } from 'zod';

// Every server process validates its environment exactly once, at startup,
// through one of the loaders below. A missing or malformed variable aborts
// the process with a non-zero exit code and the list of offending keys -
// there is no "run with a broken config" path.

const sharedShape = {
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
};

const apiConfigSchema = z.object({
  ...sharedShape,
  PORT: z.coerce.number().int().positive().default(3000),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  API_URL: z.string().url(),
});

const workerConfigSchema = z.object({
  ...sharedShape,
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  OPENAI_API_KEY: z.string().min(1),
  STORAGE_BUCKET_URL: z.string().url(),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;

class ConfigError extends Error {
  constructor(public readonly keys: string[]) {
    super(`Invalid environment configuration. Offending keys: ${keys.join(', ')}`);
    this.name = 'ConfigError';
  }
}

function parseOrExit<T>(
  schema: z.ZodType<T>,
  env: NodeJS.ProcessEnv,
  onError: (error: ConfigError) => never,
): T {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const keys = Array.from(
    new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)')),
  );
  return onError(new ConfigError(keys));
}

function exit(error: ConfigError): never {
  console.error(error.message);
  process.exit(1);
}

let apiConfig: ApiConfig | undefined;
let workerConfig: WorkerConfig | undefined;

/**
 * Parse and cache the api process configuration. Call once at process start.
 * Exits the process with code 1 and the offending keys if validation fails.
 */
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  apiConfig ??= parseOrExit(apiConfigSchema, env, exit);
  return apiConfig;
}

/**
 * Parse and cache the worker process configuration. Call once at process
 * start. Exits the process with code 1 and the offending keys on failure.
 */
export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  workerConfig ??= parseOrExit(workerConfigSchema, env, exit);
  return workerConfig;
}

// Exposed for unit tests: parse against an explicit env and throw instead of
// killing the test runner.
export const __test = {
  parseApi: (env: NodeJS.ProcessEnv): ApiConfig =>
    parseOrExit(apiConfigSchema, env, (error) => {
      throw error;
    }),
  parseWorker: (env: NodeJS.ProcessEnv): WorkerConfig =>
    parseOrExit(workerConfigSchema, env, (error) => {
      throw error;
    }),
  ConfigError,
};
