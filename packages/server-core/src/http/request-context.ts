import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestStore {
  requestId: string;
}

// Per-request ambient state. The request-id middleware opens a store for the
// lifetime of each request; the problem filter and the logger read the id
// back out without threading it through every call.
const storage = new AsyncLocalStorage<RequestStore>();

export function runWithRequestContext<T>(store: RequestStore, fn: () => T): T {
  return storage.run(store, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
