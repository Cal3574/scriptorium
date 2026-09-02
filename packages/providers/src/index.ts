// @scriptorium/providers is the seam between the app and the external services
// it depends on: PDF extraction (LlamaParse), embeddings (OpenAI), chat
// completion (Claude), and the job queue (BullMQ / Redis). Each dependency is
// declared as an interface plus a DI token, with a live adapter and an offline
// fake. All SDK and HTTP code lives inside the adapters; nothing here imports
// `@scriptorium/database` - persistence is owned by the layers above.
//
// `server-core` binds either every live adapter or every fake, all-or-nothing,
// from `PROVIDER_MODE`.

export type {
  PdfExtractor,
  PdfExtractInput,
  PdfExtraction,
  PdfHeadingItem,
  PdfOutlineItem,
  PdfMetadata,
  PdfPage,
} from './pdf-extractor/pdf-extractor.js';
export {
  PDF_EXTRACTOR,
  PdfExtractionError,
} from './pdf-extractor/pdf-extractor.js';
export { FakePdfExtractor } from './pdf-extractor/fake-pdf-extractor.js';
export {
  LlamaParseExtractor,
  type LlamaParseExtractorOptions,
} from './pdf-extractor/llamaparse-pdf-extractor.js';

export type { EmbeddingClient } from './embedding-client/embedding-client.js';
export {
  EMBEDDING_CLIENT,
  EMBEDDING_DIMENSIONS,
} from './embedding-client/embedding-client.js';
export { FakeEmbeddingClient } from './embedding-client/fake-embedding-client.js';
export {
  OpenAiEmbeddingClient,
  type OpenAiEmbeddingClientOptions,
} from './embedding-client/openai-embedding-client.js';

export type {
  LlmClient,
  LlmMessage,
  LlmRequest,
} from './llm-client/llm-client.js';
export { LLM_CLIENT } from './llm-client/llm-client.js';
export { FakeLlmClient } from './llm-client/fake-llm-client.js';
export {
  ClaudeLlmClient,
  type ClaudeLlmClientOptions,
} from './llm-client/claude-llm-client.js';

export type {
  ObjectStorage,
  PresignedPutRequest,
  StoredObjectHead,
} from './object-storage/object-storage.js';
export { OBJECT_STORAGE } from './object-storage/object-storage.js';
export {
  FakeObjectStorage,
  FAKE_UPLOAD_ROUTE,
  type FakeObjectStorageOptions,
} from './object-storage/fake-object-storage.js';
export {
  S3ObjectStorage,
  type S3ObjectStorageOptions,
} from './object-storage/s3-object-storage.js';

export type { Queue, DeleteJobData } from './queue/queue.js';
export { QUEUE } from './queue/queue.js';
export { FakeQueue, type RecordedJob } from './queue/fake-queue.js';
export { BullMqQueue, type BullMqQueueOptions } from './queue/bullmq-queue.js';
