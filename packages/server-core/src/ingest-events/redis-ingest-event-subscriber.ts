import {
  bookEventsChannel,
  bookEventsSeqKey,
  IngestEvent,
} from '@scriptorium/contracts';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { IngestEventSubscriber } from './ingest-event-subscriber.js';

type Handler = (event: IngestEvent) => void;

/**
 * Live {@link IngestEventSubscriber} over Redis. A client in subscriber mode
 * cannot run other commands, so this keeps two connections: `subscriber` for
 * pub/sub and `commands` for the `GET` behind {@link currentSeq}. Fan-out is
 * in-process - one Redis subscription per book channel, shared by every open
 * `EventSource` for that book, torn down when the last one disconnects.
 */
export class RedisIngestEventSubscriber
  extends IngestEventSubscriber
  implements OnApplicationShutdown
{
  private readonly subscriber: Redis;
  private readonly commands: Redis;
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(redisUrl: string) {
    super();
    this.subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.commands = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.subscriber.on('message', (channel, message) => {
      const handlers = this.handlers.get(channel);
      if (!handlers || handlers.size === 0) return;
      const parsed = IngestEvent.safeParse(safeJson(message));
      if (!parsed.success) return;
      for (const handler of handlers) handler(parsed.data);
    });
  }

  async currentSeq(bookId: string): Promise<number> {
    const raw = await this.commands.get(bookEventsSeqKey(bookId));
    const value = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  async subscribe(bookId: string, onEvent: Handler): Promise<() => void> {
    const channel = bookEventsChannel(bookId);
    let handlers = this.handlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(channel, handlers);
      await this.subscriber.subscribe(channel);
    }
    handlers.add(onEvent);

    return () => {
      const set = this.handlers.get(channel);
      if (!set) return;
      set.delete(onEvent);
      if (set.size === 0) {
        this.handlers.delete(channel);
        void this.subscriber.unsubscribe(channel);
      }
    };
  }

  async close(): Promise<void> {
    await Promise.all([this.subscriber.quit(), this.commands.quit()]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
