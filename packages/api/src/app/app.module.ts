import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from '@scriptorium/config';
import { DEFAULT_SSE_HEARTBEAT_MS } from '@scriptorium/contracts';
import {
  BooksRepository,
  HttpCoreModule,
  IngestEventStream,
  INGEST_EVENT_SUBSCRIBER,
  ProvidersModule,
  QueriesRepository,
  RedisIngestEventSubscriber,
} from '@scriptorium/server-core';
import { BooksController } from '../books/books.controller';
import { BookEventsController } from '../books/books-events.controller';
import { MAX_UPLOAD_BYTES, SSE_HEARTBEAT_MS } from '../books/books.tokens';
import { DevUploadsController } from '../books/dev-uploads.controller';
import { MeController } from '../me/me.controller';
import { QueriesController } from '../queries/queries.controller';
import { QueryService } from '../queries/query.service';
import { RAG_CONFIG } from '../queries/queries.tokens';
import { HealthController } from './health.controller';

@Module({})
export class AppModule {
  static forRoot(config: ApiConfig): DynamicModule {
    // The dev upload route stands in for S3 and only exists in fake mode.
    const devControllers =
      config.PROVIDER_MODE === 'fake' ? [DevUploadsController] : [];

    return {
      module: AppModule,
      imports: [
        HttpCoreModule.forRoot(config),
        ProvidersModule.forRoot(config),
      ],
      controllers: [
        HealthController,
        MeController,
        BooksController,
        BookEventsController,
        QueriesController,
        ...devControllers,
      ],
      providers: [
        BooksRepository,
        QueriesRepository,
        QueryService,
        {
          provide: RAG_CONFIG,
          useValue: {
            efSearch: config.RAG_HNSW_EF_SEARCH,
            poolLimit: config.RAG_CANDIDATE_POOL,
            topK: config.RAG_TOP_K,
            maxPerBook: config.RAG_MAX_PER_BOOK,
            minSimilarity: config.RAG_MIN_SIMILARITY,
            minResults: config.RAG_MIN_RESULTS,
            lowConfidenceK: config.RAG_LOWCONF_K,
          },
        },
        { provide: MAX_UPLOAD_BYTES, useValue: config.MAX_UPLOAD_BYTES },
        {
          provide: SSE_HEARTBEAT_MS,
          useValue: config.SSE_HEARTBEAT_MS ?? DEFAULT_SSE_HEARTBEAT_MS,
        },
        {
          provide: INGEST_EVENT_SUBSCRIBER,
          useFactory: () => new RedisIngestEventSubscriber(config.REDIS_URL),
        },
        IngestEventStream,
      ],
    };
  }
}
