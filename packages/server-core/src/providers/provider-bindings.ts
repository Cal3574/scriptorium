import type { Provider } from '@nestjs/common';
import {
  BullMqQueue,
  ClaudeLlmClient,
  EMBEDDING_CLIENT,
  FakeEmbeddingClient,
  FakeLlmClient,
  FakePdfExtractor,
  LLM_CLIENT,
  LlamaParseExtractor,
  OpenAiEmbeddingClient,
  PDF_EXTRACTOR,
  QUEUE,
} from '@scriptorium/providers';
import { requireKey, type ProviderRuntimeConfig } from './provider-config.js';

// Build the DI bindings for the four external-service seams. The three AI
// adapters are switched all-or-nothing by `mode`: fake mode binds every fake,
// live mode binds every live adapter and fails fast if a key is missing. There
// is deliberately no per-provider override - a real LLM with fake embeddings
// produces incoherent RAG results.
//
// The queue is always the live BullMQ adapter: local dev runs a real Redis
// from docker-compose, so there is no fake for it.
export function selectProviderBindings(
  config: ProviderRuntimeConfig,
): Provider[] {
  const aiBindings: Provider[] =
    config.mode === 'fake'
      ? [
          { provide: PDF_EXTRACTOR, useClass: FakePdfExtractor },
          { provide: EMBEDDING_CLIENT, useClass: FakeEmbeddingClient },
          { provide: LLM_CLIENT, useFactory: () => new FakeLlmClient() },
        ]
      : [
          {
            provide: PDF_EXTRACTOR,
            useFactory: () =>
              new LlamaParseExtractor({
                apiKey: requireKey(
                  config.llamaparseApiKey,
                  'LLAMAPARSE_API_KEY',
                ),
              }),
          },
          {
            provide: EMBEDDING_CLIENT,
            useFactory: () =>
              new OpenAiEmbeddingClient({
                apiKey: requireKey(config.openaiApiKey, 'OPENAI_API_KEY'),
              }),
          },
          {
            provide: LLM_CLIENT,
            useFactory: () =>
              new ClaudeLlmClient({
                apiKey: requireKey(config.anthropicApiKey, 'ANTHROPIC_API_KEY'),
              }),
          },
        ];

  const queueBinding: Provider = {
    provide: QUEUE,
    useFactory: () => new BullMqQueue({ redisUrl: config.redisUrl }),
  };

  return [...aiBindings, queueBinding];
}
