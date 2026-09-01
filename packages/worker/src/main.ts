import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadWorkerConfig } from '@scriptorium/config';
import { RequestAwareLogger } from '@scriptorium/server-core';
import { AppModule } from './app/app.module';

// The worker runs no HTTP server: it is a BullMQ consumer on the `ingest`
// queue plus the shared DB pool and provider adapters. `createApplication
// context` boots the DI container without binding a port; the BullMQ worker
// (live mode) keeps the event loop alive.
async function bootstrap() {
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
