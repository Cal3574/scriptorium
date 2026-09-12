import type { Provider } from '@nestjs/common';
import {
  BullMqQueue,
  ClaudeLlmClient,
  DoclingPdfExtractor,
  EMBEDDING_CLIENT,
  FakeEmbeddingClient,
  FakeLlmClient,
  FakeObjectStorage,
  FakePdfExtractor,
  FakeQueue,
  LLM_CLIENT,
  OBJECT_STORAGE,
  OpenAiEmbeddingClient,
  PDF_EXTRACTOR,
  QUEUE,
  S3ObjectStorage,
} from '@scriptorium/providers';
import { requireKey, type ProviderRuntimeConfig } from './provider-config.js';

// Build the DI bindings for the four external-service seams. The three AI
// adapters are switched all-or-nothing by `mode`: fake mode binds every fake,
// live mode binds every live adapter and fails fast if a key is missing.
//
// The queue and object storage follow the same switch. Fake mode binds the
// in-memory `FakeQueue` / `FakeObjectStorage` so the API runs with no network;
// live mode binds BullMQ on Redis and S3.

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
              new DoclingPdfExtractor({
                baseUrl: requireKey(config.doclingUrl, 'DOCLING_URL'),
                apiKey: requireKey(config.doclingApiKey, 'DOCLING_API_KEY'),
                documentTimeoutSeconds: config.doclingDocumentTimeoutSeconds,
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

  const queueBinding: Provider =
    config.mode === 'fake'
      ? { provide: QUEUE, useClass: FakeQueue }
      : {
          provide: QUEUE,
          useFactory: () => new BullMqQueue({ redisUrl: config.redisUrl }),
        };

  const objectStorageBinding: Provider =
    config.mode === 'fake'
      ? {
          provide: OBJECT_STORAGE,
          useFactory: () =>
            new FakeObjectStorage({ publicBaseUrl: config.apiUrl }),
        }
      : {
          provide: OBJECT_STORAGE,
          useFactory: () =>
            new S3ObjectStorage({
              bucket: requireKey(config.s3Bucket, 'S3_BUCKET'),
              region: requireKey(config.s3Region, 'S3_REGION'),
              accessKeyId: requireKey(
                config.awsAccessKeyId,
                'AWS_ACCESS_KEY_ID',
              ),
              secretAccessKey: requireKey(
                config.awsSecretAccessKey,
                'AWS_SECRET_ACCESS_KEY',
              ),
              endpoint: config.s3Endpoint,
            }),
        };

  return [...aiBindings, queueBinding, objectStorageBinding];
}
