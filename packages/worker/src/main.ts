/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadWorkerConfig } from '@scriptorium/config';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const config = loadWorkerConfig();
  Logger.log(`Worker concurrency: ${config.WORKER_CONCURRENCY}`);
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'worker';
  app.setGlobalPrefix(globalPrefix);
  const port = config.WORKER_PORT;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
