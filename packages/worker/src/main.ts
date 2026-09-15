import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadWorkerConfig } from '@scriptorium/config';
import { RequestAwareLogger } from '@scriptorium/server-core';
import { AppModule } from './app/app.module';
import { BackfillModule } from './backfill/backfill.module';
import { CoverBackfillService } from './backfill/cover-backfill.service';

// An operator-triggered maintenance pass, not the queue consumer: render a
// cover for every book that predates the client sending its own
// (`worker:backfill-covers`, `node dist/main.js --backfill-covers`). Boots
// `BackfillModule`, not `AppModule` - `AppModule`'s live-mode `IngestWorker`
// provider connects to Redis and starts consuming the `ingest` queue from its
// `onModuleInit` the instant the application context exists, which would
// turn this one-off script into an indefinitely-running queue consumer too.
async function runBackfillCovers(): Promise<void> {
  const config = loadWorkerConfig();
  const app = await NestFactory.createApplicationContext(
    BackfillModule.forRoot(config),
    { bufferLogs: true },
  );
  app.useLogger(new RequestAwareLogger());
  // Without this, `app.close()` below never fires `onApplicationShutdown` -
  // NestJS only wires that hook up when shutdown hooks are explicitly
  // enabled - so `DatabaseModule`'s pg pool (closed from exactly that hook)
  // stays open indefinitely.
  app.enableShutdownHooks();
  let exitCode = 0;
  try {
    const result = await app.get(CoverBackfillService).run();
    Logger.log(
      `Cover backfill complete: ${result.processed} processed, ` +
        `${result.updated} updated, ${result.skipped} skipped`,
    );
  } catch (err) {
    Logger.error(err instanceof Error ? err.stack : String(err));
    exitCode = 1;
  } finally {
    await app.close();
  }
  // `ProvidersModule`'s live-mode S3 client keeps a keep-alive HTTP agent
  // open (the AWS SDK v3 default), which - unlike the pg pool above - has no
  // Nest lifecycle hook to close it and would otherwise hold the process
  // open until those sockets time out on their own. A one-off script should
  // not be at the mercy of that timer.
  process.exit(exitCode);
}

// The worker runs no HTTP server: it is a BullMQ consumer on the `ingest`
// queue plus the shared DB pool and provider adapters. `createApplication
// context` boots the DI container without binding a port; the BullMQ worker
// (live mode) keeps the event loop alive.
async function bootstrap() {
  if (process.argv.includes('--backfill-covers')) {
    await runBackfillCovers();
    return;
  }

  const config = loadWorkerConfig();
  const app = await NestFactory.createApplicationContext(
    AppModule.forRoot(config),
    { bufferLogs: true },
  );
  app.useLogger(new RequestAwareLogger());
  app.enableShutdownHooks();

  if (config.PROVIDER_MODE === 'fake') {
    Logger.warn(
      'PROVIDER_MODE=fake: no queue consumer is running. The ingest ' +
        'pipeline is driven directly by the seam-2 integration tests.',
    );
    // Nothing else holds the event loop open in fake mode; park on a timer so
    // `nx serve worker` does not treat the clean exit as a crash and
    // restart-loop. (Signal listeners alone do not keep Node alive.)
    const keepAlive = setInterval(() => undefined, 1 << 30);
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    clearInterval(keepAlive);
    await app.close();
    return;
  }

  Logger.log('🛠  Worker started, consuming the ingest queue');
}

bootstrap();
