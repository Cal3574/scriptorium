import {
  ConfigError,
  parseApiConfig,
  parseWorkerConfig,
} from './load-config.js';

const liveProviderKeys = {
  LLAMAPARSE_API_KEY: 'llx-test',
  OPENAI_API_KEY: 'sk-openai',
  ANTHROPIC_API_KEY: 'sk-ant-test',
};

const validApiEnv = {
  DATABASE_URL: 'postgres://localhost:5432/scriptorium',
  REDIS_URL: 'redis://localhost:6379',
  CLERK_SECRET_KEY: 'sk_test_x',
  CLERK_PUBLISHABLE_KEY: 'pk_test_x',
  CLERK_JWT_KEY: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
  API_URL: 'http://localhost:3000',
  CLIENT_ORIGIN: 'http://localhost:4200',
  ...liveProviderKeys,
};

const validWorkerEnv = {
  DATABASE_URL: 'postgres://localhost:5432/scriptorium',
  REDIS_URL: 'redis://localhost:6379',
  STORAGE_BUCKET_URL: 'http://localhost:9000/bucket',
  ...liveProviderKeys,
};

describe('parseApiConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = parseApiConfig({ ...validApiEnv });
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.DATABASE_URL).toBe(validApiEnv.DATABASE_URL);
  });

  it('coerces PORT from a string', () => {
    expect(parseApiConfig({ ...validApiEnv, PORT: '8080' }).PORT).toBe(8080);
  });

  it('throws with the offending keys when variables are missing', () => {
    expect(() =>
      parseApiConfig({ DATABASE_URL: validApiEnv.DATABASE_URL }),
    ).toThrow(/REDIS_URL/);

    try {
      parseApiConfig({});
      fail('expected ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).keys).toEqual(
        expect.arrayContaining([
          'DATABASE_URL',
          'REDIS_URL',
          'CLERK_SECRET_KEY',
        ]),
      );
    }
  });

  it('rejects a malformed URL', () => {
    expect(() =>
      parseApiConfig({ ...validApiEnv, DATABASE_URL: 'not-a-url' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('requires the Clerk JWT key and client origin', () => {
    const { CLERK_JWT_KEY, CLIENT_ORIGIN, ...rest } = validApiEnv;
    void [CLERK_JWT_KEY, CLIENT_ORIGIN];
    try {
      parseApiConfig(rest);
      fail('expected ConfigError');
    } catch (error) {
      expect((error as ConfigError).keys).toEqual(
        expect.arrayContaining(['CLERK_JWT_KEY', 'CLIENT_ORIGIN']),
      );
    }
  });
});

describe('parseWorkerConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = parseWorkerConfig({ ...validWorkerEnv });
    expect(config.WORKER_PORT).toBe(3001);
    expect(config.WORKER_CONCURRENCY).toBe(4);
    expect(config.OPENAI_API_KEY).toBe('sk-openai');
  });

  it('defaults PROVIDER_MODE to live', () => {
    expect(parseWorkerConfig({ ...validWorkerEnv }).PROVIDER_MODE).toBe('live');
  });
});

describe('PROVIDER_MODE', () => {
  it('requires all three provider keys when live', () => {
    const { LLAMAPARSE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, ...rest } =
      validApiEnv;
    void [LLAMAPARSE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY];
    try {
      parseApiConfig({ ...rest, PROVIDER_MODE: 'live' });
      fail('expected ConfigError');
    } catch (error) {
      expect((error as ConfigError).keys).toEqual(
        expect.arrayContaining([
          'LLAMAPARSE_API_KEY',
          'OPENAI_API_KEY',
          'ANTHROPIC_API_KEY',
        ]),
      );
    }
  });

  it('does not require the provider keys when fake', () => {
    const { LLAMAPARSE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, ...rest } =
      validWorkerEnv;
    void [LLAMAPARSE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY];
    const config = parseWorkerConfig({ ...rest, PROVIDER_MODE: 'fake' });
    expect(config.PROVIDER_MODE).toBe('fake');
    expect(config.OPENAI_API_KEY).toBeUndefined();
  });

  it('rejects an unknown PROVIDER_MODE', () => {
    expect(() =>
      parseApiConfig({ ...validApiEnv, PROVIDER_MODE: 'hybrid' }),
    ).toThrow(/PROVIDER_MODE/);
  });
});
