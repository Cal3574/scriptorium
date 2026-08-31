import { type DynamicModule, Module } from '@nestjs/common';
import { HttpCoreModule, type HttpCoreConfig } from '@scriptorium/server-core';
import { MeController } from '../me/me.controller';
import { HealthController } from './health.controller';

@Module({})
export class AppModule {
  static forRoot(config: HttpCoreConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [HttpCoreModule.forRoot(config)],
      controllers: [HealthController, MeController],
    };
  }
}
