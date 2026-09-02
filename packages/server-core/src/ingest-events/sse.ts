import type { IngestEvent } from '@scriptorium/contracts';

/**
 * A one-directional byte sink for a Server-Sent Events response. The HTTP
 * layer adapts the framework's response object to this; the stream logic
 * never touches Express so it stays unit-testable.
 */
export interface SseSink {
  write(chunk: string): void;
  close(): void;
  /** Register a teardown callback for when the client disconnects. */
  onClose(callback: () => void): void;
}

/** Serialize one event as an SSE frame: named event, JSON data, `seq` as the id. */
export function sseFrame(event: IngestEvent): string {
  return (
    `event: ${event.type}\n` +
    `id: ${event.seq}\n` +
    `data: ${JSON.stringify(event)}\n\n`
  );
}

/** A bare comment line - the keep-alive heartbeat. */
export const SSE_KEEPALIVE = ': keep-alive\n\n';
