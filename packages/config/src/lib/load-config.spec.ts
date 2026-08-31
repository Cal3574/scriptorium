import { __test } from './load-config.js';

const validApiEnv = {
  DATABASE_URL: 'postgres://localhost:5432/scriptorium',
  REDIS_URL: 'redis://localhost:6379',
  CLERK_SECRET_KEY: 'sk_test_x',
  CLERK_PUBLISHABLE_KEY: 'pk_test_x',
  API_URL: 'http://localhost:3000',
};

const validWorkerEnv = {
  DATABASE_URL: 'postgres://localhost:5432/scriptorium',
  REDIS_URL: 'redis://localhost:6379',
  OPENAI_API_KEY: 'sk-openai',
  STORAGE_BUCKET_URL: 'http://localhost:9000/bucket',
};

describe('loadApiConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = __test.parseApi({ ...validApiEnv });
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.DATABASE_URL).toBe(validApiEnv.DATABASE_URL);
  });

  it('coerces PORT from a string', () => {
    expect(__test.parseApi({ ...validApiEnv, PORT: '8080' }).PORT).toBe(8080);
  });

  it('throws with the offending keys when variables are missing', () => {
    expect(() =>
      __test.parseApi({ DATABASE_URL: validApiEnv.DATABASE_URL }),
    ).toThrow(/REDIS_URL/);

    try {
      __test.parseApi({});
      fail('expected ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(__test.ConfigError);
      expect((error as InstanceType<typeof __test.ConfigError>).keys).toEqual(
        expect.arrayContaining(['DATABASE_URL', 'REDIS_URL', 'CLERK_SECRET_KEY']),
      );
    }
  });

  it('rejects a malformed URL', () => {
    expect(() =>
      __test.parseApi({ ...validApiEnv, DATABASE_URL: 'not-a-url' }),
    ).toThrow(/DATABASE_URL/);
  });
});

describe('loadWorkerConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = __test.parseWorker({ ...validWorkerEnv });
    expect(config.WORKER_CONCURRENCY).toBe(4);
    expect(config.OPENAI_API_KEY).toBe('sk-openai');
  });

  it('throws when OPENAI_API_KEY is absent', () => {
    const { OPENAI_API_KEY, ...rest } = validWorkerEnv;
    void OPENAI_API_KEY;
    expect(() => __test.parseWorker(rest)).toThrow(/OPENAI_API_KEY/);
  });
});
