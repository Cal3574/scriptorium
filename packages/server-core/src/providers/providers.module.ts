import { type DynamicModule, Module } from '@nestjs/common';
import {
  EMBEDDING_CLIENT,
  LLM_CLIENT,
  OBJECT_STORAGE,
  PDF_EXTRACTOR,
  QUEUE,
} from '@scriptorium/providers';
import { selectProviderBindings } from './provider-bindings.js';
import {
  toProviderRuntimeConfig,
  type EnvProviderConfig,
} from './provider-config.js';

const EXPORTED_TOKENS = [
  PDF_EXTRACTOR,
  EMBEDDING_CLIENT,
  LLM_CLIENT,
  QUEUE,
  OBJECT_STORAGE,
];

/**
 * The api and worker apps import `ProvidersModule.forRoot(config)` to get the
 * four external-service seams bound - live adapters or fakes, chosen from
 * `PROVIDER_MODE`. Pass the loaded `ApiConfig` / `WorkerConfig` directly.
 */
@Module({})
export class ProvidersModule {
  static forRoot(config: EnvProviderConfig): DynamicModule {
    const providers = selectProviderBindings(toProviderRuntimeConfig(config));
    return {
      module: ProvidersModule,
      providers,
      exports: EXPORTED_TOKENS,
    };
  }
}
