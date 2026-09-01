import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadApiConfig } from '@scriptorium/config';
import {
  RequestAwareLogger,
  REQUEST_ID_HEADER,
} from '@scriptorium/server-core';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const config = loadApiConfig();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config),
    { bufferLogs: true, rawBody: true },
  );
  app.useLogger(new RequestAwareLogger());

  // The dev upload route (fake mode only) receives raw PDF bytes; scope the
  // raw body parser to that content type so JSON routes are untouched.
  if (config.PROVIDER_MODE === 'fake') {
    app.useBodyParser('raw', {
      type: 'application/pdf',
      limit: config.MAX_UPLOAD_BYTES,
    });
  }

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
