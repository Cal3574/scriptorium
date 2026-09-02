import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from '@scriptorium/config';
import { DEFAULT_SSE_HEARTBEAT_MS } from '@scriptorium/contracts';
import {
  BooksRepository,
  HttpCoreModule,
  IngestEventStream,
  INGEST_EVENT_SUBSCRIBER,
  ProvidersModule,
  RedisIngestEventSubscriber,
} from '@scriptorium/server-core';
import { BooksController } from '../books/books.controller';
import { BookEventsController } from '../books/books-events.controller';
import { MAX_UPLOAD_BYTES, SSE_HEARTBEAT_MS } from '../books/books.tokens';
import { DevUploadsController } from '../books/dev-uploads.controller';
import { MeController } from '../me/me.controller';
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
        ...devControllers,
      ],
      providers: [
        BooksRepository,
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
