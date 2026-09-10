import { useAuth } from '@clerk/react';
import { useEffect, useRef, useState } from 'react';
import { IngestEvent } from '@scriptorium/contracts';
import { env } from '../env';
import { type IngestProgress, fold, safeJson } from './ingest-fold';

export type { IngestProgress } from './ingest-fold';

// The SSE `event:` names the server writes (the `type` of every `IngestEvent`
// variant). Named events do not trigger `EventSource.onmessage`, so each is
// registered explicitly.
const EVENT_NAMES = [
  'snapshot',
  'stage_entered',
  'stage_progress',
  'book_identified',
  'book_completed',
  'book_failed',
  'book_deleted',
] as const;

// Terminal events are final and idempotent, and `book_deleted` carries an
// API-synthesised `seq` that is not part of the worker's INCR sequence - so
// they are applied regardless of the stale-drop guard.
const TERMINAL_EVENTS: ReadonlySet<IngestEvent['type']> = new Set([
  'book_completed',
  'book_failed',
  'book_deleted',
]);

export interface UseIngestEventsResult {
  progress: IngestProgress | null;
  connected: boolean;
  deleted: boolean;
}

/**
 * Subscribe to `GET /books/:id/events` for as long as `enabled` is true and
 * the book has not reached a terminal state. Returns the folded progress, or
 * null until the opening snapshot lands.
 */
export function useIngestEvents(
  bookId: string,
  enabled: boolean,
): UseIngestEventsResult {
  const { getToken } = useAuth();
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [connected, setConnected] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const lastSeq = useRef(-1);

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let cancelled = false;
    lastSeq.current = -1;

    void getToken().then((token) => {
      if (cancelled || !token) return;
      const url = `${env.apiUrl}/api/v1/books/${bookId}/events?token=${encodeURIComponent(
        token,
      )}`;
      source = new EventSource(url);
      source.onopen = () => setConnected(true);
      source.onerror = () => setConnected(false);
      source.onmessage = (message) => apply(message.data);
      for (const type of EVENT_NAMES) {
        source.addEventListener(type, (e) =>
          apply((e as MessageEvent<string>).data),
        );
      }
    });

    function apply(raw: string) {
      const parsed = IngestEvent.safeParse(safeJson(raw));
      if (!parsed.success) return;
      const event = parsed.data;
      const terminal = TERMINAL_EVENTS.has(event.type);
      if (!terminal && event.seq <= lastSeq.current) return;
      if (event.seq > lastSeq.current) lastSeq.current = event.seq;
      setProgress((prev) => fold(prev, event));
      if (event.type === 'book_deleted') {
        setDeleted(true);
        source?.close();
      }
      if (event.type === 'book_completed' || event.type === 'book_failed') {
        source?.close();
      }
    }

    return () => {
      cancelled = true;
      source?.close();
      setConnected(false);
    };
  }, [bookId, enabled, getToken]);

  return { progress, connected, deleted };
}
