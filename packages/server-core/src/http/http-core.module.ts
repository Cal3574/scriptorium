import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard.js';
import { ClerkTokenVerifier, TokenVerifier } from '../auth/token-verifier.js';
import { DatabaseModule } from '../database/database.module.js';
import { UsersRepository } from '../users/users.repository.js';
import { ProblemDetailsFilter } from './problem-details.filter.js';
import { RequestIdMiddleware } from './request-id.middleware.js';

export interface HttpCoreConfig {
  DATABASE_URL: string;
  CLERK_JWT_KEY: string;
  CLIENT_ORIGIN: string;
}

/**
 * The one import an HTTP app needs for identity and the cross-cutting
 * concerns that ride with it: the database pool, the global Clerk auth guard,
 * JIT user provisioning, the request-id middleware, the Zod validation pipe,
 * and the single RFC 9457 problem filter.
 */
@Module({})
export class HttpCoreModule implements NestModule {
  static forRoot(config: HttpCoreConfig): DynamicModule {
    return {
      module: HttpCoreModule,
      imports: [DatabaseModule.forRoot(config)],
      providers: [
        UsersRepository,
        {
          provide: TokenVerifier,
          useFactory: () =>
            new ClerkTokenVerifier({
              jwtKey: config.CLERK_JWT_KEY,
              authorizedParties: [config.CLIENT_ORIGIN],
            }),
        },
        { provide: APP_GUARD, useClass: ClerkAuthGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
      ],
      exports: [UsersRepository, TokenVerifier],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
