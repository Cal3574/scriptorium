// The minimal slices of the Express response / request a POST-response SSE
// handler needs, declared locally so callers don't pull in `@types/express`.
export interface PostSseResponse {
  setHeader(name: string, value: string): void;
  flushHeaders(): void;
  write(chunk: string): void;
  end(): void;
}
export interface PostSseRequest {
  on(event: 'close', listener: () => void): void;
}

/**
 * Drains an async generator of stream events over the body of a `POST`
 * response as Server-Sent Events - the shape both the Ask library query
 * endpoint and the Agent endpoint stream on (a browser reads a `POST` SSE
 * response with `fetch()` + a `ReadableStream` reader, not `EventSource`,
 * which only supports `GET`).
 *
 * The caller has already pulled the generator's first value (`first`) before
 * calling this, so a failure that happens before any event is yielded - a
 * validation error, a failed pre-flight lookup - still surfaces as
 * problem+json from the global filter rather than as a half-open stream; this
 * function only ever writes bytes once that first value is in hand.
 *
 * A browser disconnect (`req`'s `close` event) aborts `signal` and stops
 * pulling the generator, calling `.return()` so it unwinds cleanly instead of
 * running a paid generation to completion for nobody.
 */
export async function pumpPostSseStream<T>(
  req: PostSseRequest,
  res: PostSseResponse,
  first: IteratorResult<T>,
  events: AsyncGenerator<T>,
  abort: AbortController,
  frameOf: (event: T) => string,
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let disconnected = false;
  req.on('close', () => {
    disconnected = true;
    abort.abort();
    void Promise.resolve(events.return?.(undefined)).catch(() => undefined);
  });

  for (
    let current = first;
    !current.done && !disconnected;
    current = await events.next()
  ) {
    res.write(frameOf(current.value));
  }

  if (!disconnected) res.end();
}
