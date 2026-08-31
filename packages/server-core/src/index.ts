// @scriptorium/server-core carries cross-cutting server building blocks shared
// by the api and worker apps. Today that is the provider wiring: the DI module
// and binding logic that turn `PROVIDER_MODE` into a bound set of the four
// external-service adapters from `@scriptorium/providers`.

export { ProvidersModule } from './providers/providers.module.js';
export { selectProviderBindings } from './providers/provider-bindings.js';
export {
  toProviderRuntimeConfig,
  type ProviderMode,
  type EnvProviderConfig,
  type ProviderRuntimeConfig,
} from './providers/provider-config.js';
