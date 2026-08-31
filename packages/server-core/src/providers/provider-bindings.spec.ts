import {
  EMBEDDING_CLIENT,
  FakeEmbeddingClient,
  FakeLlmClient,
  FakePdfExtractor,
  LLM_CLIENT,
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
