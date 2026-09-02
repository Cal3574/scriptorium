import type { INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { parseApiConfig } from '@scriptorium/config';
import { RequestAwareLogger } from '@scriptorium/server-core';
import { AppModule } from '../app/app.module';
import { ProbeController } from './probe.controller';

export interface TestAppOptions {
  jwtKey: string;
  databaseUrl: string;
  clientOrigin?: string;
}

/**
 * Boots the real `api` app - the same `AppModule` `main.ts` uses, so the guard,
 * filter, middleware and logger are all exercised as shipped - wired to the
 * test Postgres and the suite's minted `CLERK_JWT_KEY`. The only addition is
 * the test-only {@link ProbeController} mounted alongside the real routes.
 */
export async function createTestApp(
  options: TestAppOptions,
): Promise<INestApplication> {
  const config = parseApiConfig({
    DATABASE_URL: options.databaseUrl,
    REDIS_URL: 'redis://localhost:6379',
    CLERK_SECRET_KEY: 'sk_test',
    CLERK_PUBLISHABLE_KEY: 'pk_test',
    CLERK_JWT_KEY: options.jwtKey,
    API_URL: 'http://localhost:3000',
    CLIENT_ORIGIN: options.clientOrigin ?? 'http://localhost:4200',
    PROVIDER_MODE: 'fake',
    // Fast keep-alive so the SSE suite can assert the delete-detection path
    // without waiting the production 15 seconds.
    SSE_HEARTBEAT_MS: '300',
  });

  @Module({
    imports: [AppModule.forRoot(config)],
    controllers: [ProbeController],
  })
  class TestAppModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestAppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(new RequestAwareLogger());
  // Mirrors `main.ts`: the fake-mode dev upload route takes raw PDF bytes.
  app.useBodyParser('raw', {
    type: 'application/pdf',
    limit: 64 * 1024 * 1024,
  });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableShutdownHooks();
  await app.init();
  return app;
}
