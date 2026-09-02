import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type { WorkerConfig } from '@scriptorium/config';
import {
  DatabaseModule,
  IngestRepository,
  ProvidersModule,
} from '@scriptorium/server-core';
import { EVENT_TRANSPORT } from '../ingest/event-transport.js';
import { InMemoryEventTransport } from '../ingest/event-transport.js';
import { RedisEventTransport } from '../ingest/redis-event-transport.js';
import { IngestProcessor } from '../ingest/ingest-processor.js';
import { IngestWorker } from '../ingest/ingest-worker.js';
import { StageEventPublisher } from '../ingest/stage-event-publisher.js';

// Kept in step with the queue's `defaultJobOptions.attempts` in
// `@scriptorium/providers` (`BullMqQueue`). One initial run plus three retries.
const JOB_ATTEMPTS = 4;

@Module({})
export class AppModule {
  static forRoot(config: WorkerConfig): DynamicModule {
    const live = config.PROVIDER_MODE === 'live';

    const eventTransport: Provider = live
      ? {
          provide: EVENT_TRANSPORT,
          useFactory: () => new RedisEventTransport(config.REDIS_URL),
        }
      : { provide: EVENT_TRANSPORT, useClass: InMemoryEventTransport };

    // The BullMQ consumer connects to Redis on init, so it is only wired in
    // live mode. In fake mode the pipeline is exercised in-process by the
    // seam-2 integration tests, which construct an `IngestProcessor` directly.
    const queueConsumer: Provider[] = live
      ? [
          {
            provide: IngestWorker,
            useFactory: (processor: IngestProcessor) =>
              new IngestWorker(processor, {
                redisUrl: config.REDIS_URL,
                attempts: JOB_ATTEMPTS,
              }),
            inject: [IngestProcessor],
          },
        ]
      : [];

    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(config),
        ProvidersModule.forRoot(config),
      ],
      providers: [
        IngestRepository,
        StageEventPublisher,
        eventTransport,
        IngestProcessor,
        ...queueConsumer,
      ],
    };
  }
}
