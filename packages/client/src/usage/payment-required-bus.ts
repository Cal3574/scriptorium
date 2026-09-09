// A process-wide signal that some API call came back `402 Payment Required`
// (a plan limit was hit). `useApi` publishes it from the one place every
// request funnels through; the usage provider subscribes and refetches the
// meter so it flips to its red state without the caller having to know the
// meter exists. Deliberately tiny - one synchronous fan-out, no payload.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to 402s. Returns an unsubscribe function for effect cleanup. */
export function onPaymentRequired(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called by `useApi` whenever a response status is 402. */
export function notifyPaymentRequired(): void {
  for (const listener of listeners) listener();
}
