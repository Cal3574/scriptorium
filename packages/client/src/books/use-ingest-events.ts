import { useAuth } from '@clerk/react';
import { useEffect, useRef, useState } from 'react';
import {
  type BookStatus,
  IngestEvent,
  type ProcessingStage,
} from '@scriptorium/contracts';
import { env } from '../env';

// The live view of a book's ingest, folded from the SSE stream. Seeded by the
// `snapshot` frame, then advanced by each delta. `stale` events (a `seq` at or
// below one already applied) are dropped so a reconnect never double-counts.
export interface IngestProgress {
  status: BookStatus;
  stage: ProcessingStage | null;
  progress: { done: number; total: number; unit: 'chunks' | 'chapters' } | null;
  chaptersTotal: number;
  chaptersSummarized: number;
  title: string | null;
  author: string | null;
  failedStage: string | null;
  failureReason: string | null;
}

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

function fold(
  prev: IngestProgress | null,
  event: IngestEvent,
): IngestProgress | null {
  switch (event.type) {
    case 'snapshot':
      return {
        status: event.status,
        stage: event.stage,
        progress: event.progress,
        chaptersTotal: event.chaptersTotal,
        chaptersSummarized: event.chaptersSummarized,
        title: event.title,
        author: event.author,
        failedStage: event.failedStage,
        failureReason: event.failureReason,
      };
    case 'stage_entered':
      return (
        prev && {
          ...prev,
          stage: event.stage,
          status: event.status,
          progress: null,
        }
      );
    case 'stage_progress':
      return (
        prev && {
          ...prev,
          stage: event.stage,
          progress: { done: event.done, total: event.total, unit: event.unit },
        }
      );
    case 'book_identified':
      return prev && { ...prev, title: event.title, author: event.author };
    case 'book_completed':
      return prev && { ...prev, status: 'ready', stage: null, progress: null };
    case 'book_failed':
      return (
        prev && {
          ...prev,
          status: 'failed',
          stage: null,
          failedStage: event.failedStage,
          failureReason: event.failureReason,
        }
      );
    case 'book_deleted':
      return prev && { ...prev, status: 'deleting' };
    default:
      return prev;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
