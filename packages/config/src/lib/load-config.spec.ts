import {
  ConfigError,
  parseApiConfig,
  parseWorkerConfig,
} from './load-config.js';

const liveProviderKeys = {
  GEMINI_API_KEY: 'gm-test',
  LLAMAPARSE_API_KEY: 'llx-test',
  OPENAI_API_KEY: 'sk-openai',
  ANTHROPIC_API_KEY: 'sk-ant-test',
};

const liveS3Keys = {
  S3_BUCKET: 'scriptorium-uploads-test',
  S3_REGION: 'eu-west-2',
  AWS_ACCESS_KEY_ID: 'AKIATEST',
  AWS_SECRET_ACCESS_KEY: 'secret-test',
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
  ...liveS3Keys,
};

const validWorkerEnv = {
  DATABASE_URL: 'postgres://localhost:5432/scriptorium',
  REDIS_URL: 'redis://localhost:6379',
  ...liveProviderKeys,
  ...liveS3Keys,
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

  it('requires the S3 keys when live (the worker reads and writes objects too)', () => {
    const {
      S3_BUCKET,
      S3_REGION,
      AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY,
      ...rest
    } = validWorkerEnv;
    void [S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY];
    try {
      parseWorkerConfig({ ...rest, PROVIDER_MODE: 'live' });
      fail('expected ConfigError');
    } catch (error) {
      expect((error as ConfigError).keys).toEqual(
        expect.arrayContaining([
          'S3_BUCKET',
          'S3_REGION',
          'AWS_ACCESS_KEY_ID',
          'AWS_SECRET_ACCESS_KEY',
        ]),
      );
    }
  });

  it('does not require the S3 keys when fake', () => {
    const {
      S3_BUCKET,
      S3_REGION,
      AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY,
      ...rest
    } = validWorkerEnv;
    void [S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY];
    expect(() =>
      parseWorkerConfig({ ...rest, PROVIDER_MODE: 'fake' }),
    ).not.toThrow();
  });
});

describe('PROVIDER_MODE', () => {
  it('requires OpenAI, Anthropic and the selected extractor key when live', () => {
    const {
      GEMINI_API_KEY,
      LLAMAPARSE_API_KEY,
      OPENAI_API_KEY,
      ANTHROPIC_API_KEY,
      ...rest
    } = validApiEnv;
    void [
      GEMINI_API_KEY,
      LLAMAPARSE_API_KEY,
      OPENAI_API_KEY,
      ANTHROPIC_API_KEY,
    ];
    try {
      parseApiConfig({ ...rest, PROVIDER_MODE: 'live' });
      fail('expected ConfigError');
    } catch (error) {
      expect((error as ConfigError).keys).toEqual(
        expect.arrayContaining([
          'GEMINI_API_KEY',
          'OPENAI_API_KEY',
          'ANTHROPIC_API_KEY',
        ]),
      );
      // LlamaParse is not the default extractor - its key is not required.
      expect((error as ConfigError).keys).not.toContain('LLAMAPARSE_API_KEY');
    }
  });

  it('does not require the provider keys when fake', () => {
    const {
      GEMINI_API_KEY,
      LLAMAPARSE_API_KEY,
      OPENAI_API_KEY,
      ANTHROPIC_API_KEY,
      ...rest
    } = validWorkerEnv;
    void [
      GEMINI_API_KEY,
      LLAMAPARSE_API_KEY,
      OPENAI_API_KEY,
      ANTHROPIC_API_KEY,
    ];
    const config = parseWorkerConfig({ ...rest, PROVIDER_MODE: 'fake' });
    expect(config.PROVIDER_MODE).toBe('fake');
    expect(config.OPENAI_API_KEY).toBeUndefined();
  });

  it('treats an empty-string provider key as unset in fake mode', () => {
    const config = parseWorkerConfig({
      ...validWorkerEnv,
      PROVIDER_MODE: 'fake',
      LLAMAPARSE_API_KEY: '',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
    });
    expect(config.OPENAI_API_KEY).toBeUndefined();
  });

  it('rejects an unknown PROVIDER_MODE', () => {
    expect(() =>
      parseApiConfig({ ...validApiEnv, PROVIDER_MODE: 'hybrid' }),
    ).toThrow(/PROVIDER_MODE/);
  });

  it('requires the S3 upload keys when live', () => {
    const {
      S3_BUCKET,
      S3_REGION,
      AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY,
      ...rest
    } = validApiEnv;
    void [S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY];
    try {
      parseApiConfig({ ...rest, PROVIDER_MODE: 'live' });
      fail('expected ConfigError');
    } catch (error) {
      expect((error as ConfigError).keys).toEqual(
        expect.arrayContaining([
          'S3_BUCKET',
          'S3_REGION',
          'AWS_ACCESS_KEY_ID',
          'AWS_SECRET_ACCESS_KEY',
        ]),
      );
    }
  });

  it('does not require the S3 keys when fake, and defaults MAX_UPLOAD_BYTES', () => {
    const {
      S3_BUCKET,
      S3_REGION,
      AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY,
      ...rest
    } = validApiEnv;
    void [S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY];
    const config = parseApiConfig({ ...rest, PROVIDER_MODE: 'fake' });
    expect(config.MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe('PDF_EXTRACTOR', () => {
  it('defaults to gemini with the spec Gemini tuning defaults', () => {
    const config = parseWorkerConfig({ ...validWorkerEnv });
    expect(config.PDF_EXTRACTOR).toBe('gemini');
    expect(config.GEMINI_MODEL).toBe('gemini-2.5-flash-lite');
    expect(config.GEMINI_PAGES_PER_BATCH).toBe(10);
    expect(config.GEMINI_BATCH_CONCURRENCY).toBe(5);
  });

  it('coerces the Gemini tuning numbers from strings', () => {
    const config = parseWorkerConfig({
      ...validWorkerEnv,
      GEMINI_PAGES_PER_BATCH: '6',
      GEMINI_BATCH_CONCURRENCY: '2',
    });
    expect(config.GEMINI_PAGES_PER_BATCH).toBe(6);
    expect(config.GEMINI_BATCH_CONCURRENCY).toBe(2);
  });

  it('requires GEMINI_API_KEY and not LLAMAPARSE_API_KEY when live + gemini', () => {
    const { GEMINI_API_KEY, LLAMAPARSE_API_KEY, ...rest } = validWorkerEnv;
    void [GEMINI_API_KEY, LLAMAPARSE_API_KEY];
    try {
      parseWorkerConfig({ ...rest, PROVIDER_MODE: 'live' });
      fail('expected ConfigError');
    } catch (error) {
      expect((error as ConfigError).keys).toContain('GEMINI_API_KEY');
      expect((error as ConfigError).keys).not.toContain('LLAMAPARSE_API_KEY');
    }
  });

  it('requires LLAMAPARSE_API_KEY and not GEMINI_API_KEY when live + llamaparse', () => {
    const { GEMINI_API_KEY, LLAMAPARSE_API_KEY, ...rest } = validWorkerEnv;
    void [GEMINI_API_KEY, LLAMAPARSE_API_KEY];
    try {
      parseWorkerConfig({
        ...rest,
        PROVIDER_MODE: 'live',
        PDF_EXTRACTOR: 'llamaparse',
      });
      fail('expected ConfigError');
    } catch (error) {
      expect((error as ConfigError).keys).toContain('LLAMAPARSE_API_KEY');
      expect((error as ConfigError).keys).not.toContain('GEMINI_API_KEY');
    }
  });

  it('accepts live + llamaparse with only the LlamaParse key', () => {
    const { GEMINI_API_KEY, ...rest } = validWorkerEnv;
    void GEMINI_API_KEY;
    expect(() =>
      parseWorkerConfig({
        ...rest,
        PROVIDER_MODE: 'live',
        PDF_EXTRACTOR: 'llamaparse',
      }),
    ).not.toThrow();
  });

  it('rejects an unknown PDF_EXTRACTOR value naming that key', () => {
    expect(() =>
      parseWorkerConfig({ ...validWorkerEnv, PDF_EXTRACTOR: 'docling' }),
    ).toThrow(/PDF_EXTRACTOR/);
  });
});
