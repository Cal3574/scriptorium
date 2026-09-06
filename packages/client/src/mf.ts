import { lazy, type ComponentType } from 'react';
import { registerRemotes, loadRemote } from '@module-federation/runtime';

import { env } from './env';

// The `my-provider` remote is external and optional (see env.ts). It is
// registered only when `VITE_PROVIDER_REMOTE_URL` points at a running
// `remoteEntry.js`; with the var unset - the normal local dev and CI case -
// nothing is registered and the consumer never tries to mount it, so a
// missing remote is silent rather than a page-wide error.
//
// `name` is the provider build's federation container name and must match the
// remote's federation `name`; `alias` is the key passed to
// loadRemote()/lazyProvider().
export const hasProviderRemote = env.providerRemoteUrl !== null;

if (hasProviderRemote) {
  // `type: 'module'` is required because the providers in this workspace are
  // vite-built and emit ESM remoteEntry.js. The federation runtime would load
  // it as a classic `<script>` tag otherwise and the browser would throw
  // `Cannot use import statement outside a module` (#RUNTIME-001).
  registerRemotes([
    {
      alias: 'my-provider',
      name: 'my_provider',
      entry: env.providerRemoteUrl as string,
      type: 'module',
    },
  ]);
}

export function lazyProvider<Props = unknown>(
  alias: string,
  exposeName: string,
) {
  return lazy(async () => {
    const mod = await loadRemote<{ default: ComponentType<Props> }>(
      `${alias}/${exposeName}`,
    );
    if (!mod) {
      throw new Error(`Failed to load remote module "${alias}/${exposeName}"`);
    }
    return { default: mod.default };
  });
}
