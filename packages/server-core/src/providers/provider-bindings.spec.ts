import {
  EMBEDDING_CLIENT,
  FakeEmbeddingClient,
  FakeLlmClient,
  FakeObjectStorage,
  FakePdfExtractor,
  FakeQueue,
  LLM_CLIENT,
  OBJECT_STORAGE,
  PDF_EXTRACTOR,
  QUEUE,
} from '@scriptorium/providers';
import { selectProviderBindings } from './provider-bindings.js';
import type { ProviderRuntimeConfig } from './provider-config.js';

const base: ProviderRuntimeConfig = {
  mode: 'fake',
  redisUrl: 'redis://localhost:6379',
};

type ClassProvider = { provide: unknown; useClass: new () => unknown };
type FactoryProvider = { provide: unknown; useFactory: () => unknown };

const byToken = (bindings: unknown[], token: unknown) =>
  bindings.find((b) => (b as { provide: unknown }).provide === token) as
    ClassProvider | FactoryProvider;

describe('selectProviderBindings', () => {
  it('binds all four seams', () => {
    const tokens = selectProviderBindings(base).map(
      (b) => (b as { provide: unknown }).provide,
    );
    expect(tokens).toEqual(
      expect.arrayContaining([
        PDF_EXTRACTOR,
        EMBEDDING_CLIENT,
        LLM_CLIENT,
        QUEUE,
        OBJECT_STORAGE,
      ]),
    );
  });

  it('binds every fake in fake mode', () => {
    const bindings = selectProviderBindings(base);
    expect((byToken(bindings, PDF_EXTRACTOR) as ClassProvider).useClass).toBe(
      FakePdfExtractor,
    );
    expect(
      (byToken(bindings, EMBEDDING_CLIENT) as ClassProvider).useClass,
    ).toBe(FakeEmbeddingClient);
    expect(
      (byToken(bindings, LLM_CLIENT) as FactoryProvider).useFactory(),
    ).toBeInstanceOf(FakeLlmClient);
    expect((byToken(bindings, QUEUE) as ClassProvider).useClass).toBe(
      FakeQueue,
    );
    expect(
      (byToken(bindings, OBJECT_STORAGE) as FactoryProvider).useFactory(),
    ).toBeInstanceOf(FakeObjectStorage);
  });

  it('binds the live S3 storage and fails fast without its keys', () => {
    const live = selectProviderBindings({ ...base, mode: 'live' });
    const storage = byToken(live, OBJECT_STORAGE) as FactoryProvider;
    expect(() => storage.useFactory()).toThrow(/S3_BUCKET/);
  });

  it('does not require provider keys in fake mode', () => {
    expect(() => selectProviderBindings(base)).not.toThrow();
  });

  it('fails fast in live mode when a key is missing', () => {
    const live = selectProviderBindings({ ...base, mode: 'live' });
    const llm = byToken(live, LLM_CLIENT) as FactoryProvider;
    expect(() => llm.useFactory()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('builds live adapters when keys are present', () => {
    const live = selectProviderBindings({
      ...base,
      mode: 'live',
      llamaparseApiKey: 'llx',
      openaiApiKey: 'sk-o',
      anthropicApiKey: 'sk-a',
    });
    for (const token of [PDF_EXTRACTOR, EMBEDDING_CLIENT, LLM_CLIENT]) {
      const binding = byToken(live, token) as FactoryProvider;
      expect(() => binding.useFactory()).not.toThrow();
    }
  });
});
