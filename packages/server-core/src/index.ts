// @scriptorium/server-core carries cross-cutting server building blocks shared
// by the api and worker apps: the provider wiring (the DI module that turns
// `PROVIDER_MODE` into a bound set of external-service adapters) and the HTTP
// core - identity, request correlation, and the RFC 9457 problem filter.

export { ProvidersModule } from './providers/providers.module.js';
export {
  OBJECT_STORAGE,
  QUEUE,
  type ObjectStorage,
  type Queue,
} from '@scriptorium/providers';
export { selectProviderBindings } from './providers/provider-bindings.js';
export {
  toProviderRuntimeConfig,
  type ProviderMode,
  type EnvProviderConfig,
  type ProviderRuntimeConfig,
} from './providers/provider-config.js';

export { DatabaseModule, DB } from './database/database.module.js';
export { UsersRepository, type LocalUser } from './users/users.repository.js';
export {
  BooksRepository,
  type BookRow,
  type ChapterRow,
  type CreateBookInput,
  type CreateBookResult,
  type UpdateBookInput,
} from './books/books.repository.js';
export {
  QueriesRepository,
  type CandidateRow,
  type RetrieveCandidatesInput,
} from './queries/queries.repository.js';
export {
  IngestRepository,
  type ExtractionResult,
  type Identification,
  type FailureMark,
  type ChapterInput,
  type ChunkInput,
  type WriteChaptersInput,
} from './ingest/ingest.repository.js';

export {
  IngestEventSubscriber,
  INGEST_EVENT_SUBSCRIBER,
} from './ingest-events/ingest-event-subscriber.js';
export { RedisIngestEventSubscriber } from './ingest-events/redis-ingest-event-subscriber.js';
export {
  buildIngestSnapshot,
  type SnapshotInputs,
} from './ingest-events/ingest-snapshot.js';
export {
  IngestEventStream,
  IngestStreamSession,
  type RunOptions,
} from './ingest-events/ingest-event-stream.js';
export { sseFrame, SSE_KEEPALIVE, type SseSink } from './ingest-events/sse.js';

export {
  HttpCoreModule,
  type HttpCoreConfig,
} from './http/http-core.module.js';
export { ClerkAuthGuard } from './auth/clerk-auth.guard.js';
export { Public, IS_PUBLIC_KEY } from './auth/public.decorator.js';
export {
  CurrentUser,
  type AuthenticatedUser,
} from './auth/current-user.decorator.js';
export {
  TokenVerifier,
  ClerkTokenVerifier,
  type VerifiedToken,
  type ClerkTokenVerifierConfig,
} from './auth/token-verifier.js';

export { ProblemDetailsFilter } from './http/problem-details.filter.js';
export { RequestAwareLogger } from './http/request-aware-logger.js';
export {
  ProblemException,
  ResourceNotFoundException,
} from './http/problem.exception.js';
export { assertOwnership } from './http/ownership.js';
export {
  RequestIdMiddleware,
  REQUEST_ID_HEADER,
} from './http/request-id.middleware.js';
export { getRequestId, runWithRequestContext } from './http/request-context.js';
