// The browser bundle's entire view of configuration. Vite statically inlines
// `import.meta.env.VITE_*` at build time, so this module deliberately does
// NOT depend on @scriptorium/config (a Node-only, process.env loader) - the
// two config surfaces are kept separate on purpose.
//
// Importing this module throws if either variable is missing, so a
// misconfigured build fails at startup rather than at first use.

interface ClientEnv {
  readonly clerkPublishableKey: string;
  readonly apiUrl: string;
  // The Module-Federation `my-provider` remote's `remoteEntry.js` URL. It is an
  // external, optional remote (not in this repo) - unset in a normal local dev
  // or CI run, in which case the consumer simply never mounts it. Set it only
  // when that remote is actually being served.
  readonly providerRemoteUrl: string | null;
}

function readEnv(): ClientEnv {
  const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const apiUrl = import.meta.env.VITE_API_URL;
  const providerRemoteUrl = import.meta.env.VITE_PROVIDER_REMOTE_URL || null;

  const missing = [
    ['VITE_CLERK_PUBLISHABLE_KEY', clerkPublishableKey],
    ['VITE_API_URL', apiUrl],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing required client environment variables: ${missing.join(', ')}`,
    );
  }

  return { clerkPublishableKey, apiUrl, providerRemoteUrl };
}

export const env: ClientEnv = readEnv();
