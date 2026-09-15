import { Module, type DynamicModule } from '@nestjs/common';
import type { WorkerConfig } from '@scriptorium/config';
import {
  BooksRepository,
  DatabaseModule,
  ProvidersModule,
} from '@scriptorium/server-core';
import { CoverBackfillService } from './cover-backfill.service.js';

/**
 * The DI graph the `--backfill-covers` maintenance pass needs: the DB pool
 * and object storage adapter, nothing pipeline-specific. Deliberately not
 * `AppModule` - that module's `live`-mode `IngestWorker` provider connects to
 * Redis and starts consuming the `ingest` queue from its `onModuleInit`
 * the moment the Nest application context is created, which would turn a
 * one-off script into an indefinitely-running queue consumer alongside it.
 */
@Module({})
export class BackfillModule {
  static forRoot(config: WorkerConfig): DynamicModule {
    return {
      module: BackfillModule,
      imports: [
        DatabaseModule.forRoot(config),
        ProvidersModule.forRoot(config),
      ],
      providers: [BooksRepository, CoverBackfillService],
    };
  }
}
