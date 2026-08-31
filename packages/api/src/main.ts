import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadApiConfig } from '@scriptorium/config';
import {
  RequestAwareLogger,
  REQUEST_ID_HEADER,
} from '@scriptorium/server-core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const config = loadApiConfig();
  const app = await NestFactory.create(AppModule.forRoot(config), {
    bufferLogs: true,
  });
  app.useLogger(new RequestAwareLogger());

  // Everything lives under `/api/v1`; `GET /health` is the one exception so
  // infra checks do not depend on the version segment.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  app.enableCors({
    origin: config.CLIENT_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Accept',
      REQUEST_ID_HEADER,
    ],
    credentials: false,
    maxAge: 86400,
  });
  app.enableShutdownHooks();

  await app.listen(config.PORT);
  Logger.log(`🚀 API listening on http://localhost:${config.PORT}/api/v1`);
}

bootstrap();
