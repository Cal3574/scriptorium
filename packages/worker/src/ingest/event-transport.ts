/**
 * The tiny slice of Redis the SSE progress layer needs: a per-book monotonic
 * counter (`INCR`) and fire-and-forget pub/sub (`PUBLISH`). Abstracted so the
 * seam-2 tests can run without a Redis, while the live worker publishes to the
 * real channel the API's `GET /books/:id/events` endpoint bridges.
 */
export interface EventTransport {
  incr(key: string): Promise<number>;
  publish(channel: string, message: string): Promise<void>;
}

export const EVENT_TRANSPORT = Symbol('EventTransport');

interface RecordedPublish {
  channel: string;
  message: string;
}

/** In-memory {@link EventTransport} for tests. */
export class InMemoryEventTransport implements EventTransport {
  private readonly counters = new Map<string, number>();
  readonly published: RecordedPublish[] = [];

  incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return Promise.resolve(next);
  }

  publish(channel: string, message: string): Promise<void> {
    this.published.push({ channel, message });
    return Promise.resolve();
  }

  /** Every published payload on `channel`, parsed. */
  eventsFor<T = unknown>(channel: string): T[] {
    return this.published
      .filter((p) => p.channel === channel)
      .map((p) => JSON.parse(p.message) as T);
  }

  clear(): void {
    this.counters.clear();
    this.published.length = 0;
  }
}
