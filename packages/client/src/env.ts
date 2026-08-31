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
}

function readEnv(): ClientEnv {
  const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const apiUrl = import.meta.env.VITE_API_URL;

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

  return { clerkPublishableKey, apiUrl };
}

export const env: ClientEnv = readEnv();
