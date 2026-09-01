import { Redis } from 'ioredis';
import type { EventTransport } from './event-transport.js';

/**
 * Live {@link EventTransport} over a dedicated Redis connection (separate from
 * the BullMQ connection - a client in subscriber mode cannot run other
 * commands, and keeping them apart avoids surprises). Publish failures are
 * swallowed: the database is the source of truth and the client re-fetches on
 * every reconnect, so a dropped event only costs a little latency.
 */
export class RedisEventTransport implements EventTransport {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
