import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from '@scriptorium/config';
import {
  BooksRepository,
  HttpCoreModule,
  ProvidersModule,
} from '@scriptorium/server-core';
import { BooksController } from '../books/books.controller';
import { MAX_UPLOAD_BYTES } from '../books/books.tokens';
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
        ...devControllers,
      ],
      providers: [
        BooksRepository,
        { provide: MAX_UPLOAD_BYTES, useValue: config.MAX_UPLOAD_BYTES },
      ],
    };
  }
}
