import { useAuth } from '@clerk/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type AgentEvent,
  type AgentMessageDto,
  type AgentThreadDto,
  parseAgentEventFrame,
} from '@scriptorium/contracts';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SummaryProse } from '@/components/prose/summary-prose';
import { ThinkingDots } from '@/components/ai/thinking-dots';
import { cn } from '@/lib/utils';
import { env } from '../env';
import {
  isLimitReached,
  problemMessage,
  type LimitCode,
} from '../books/problem';
import { useApi } from '../auth/use-api';
import { useUsage } from '../usage/use-usage';
import { LimitReachedNotice } from '../usage/limit-reached-notice';
import { useAgentBookId } from './use-agent-book-id';
import { useChatWidget } from './chat-widget-context';

type Phase = 'loading' | 'idle' | 'streaming' | 'error';

// One turn-half, rendered as a bubble. A `highlightedPassage` renders as a
// distinct quoted block above the message text, never inlined into it - the
// same structural separation the backend contract (#157) keeps in the DB.
function MessageBubble({ message }: { message: AgentMessageDto }) {
  const isUser = message.role === 'user';
  return (
    <div
      data-message
      data-role={message.role}
      className={isUser ? 'text-right' : 'text-left'}
    >
      {message.highlightedPassage && (
        <blockquote className="ai-highlight-quote bg-muted text-muted-foreground mb-1 inline-block px-3 py-2 text-left text-sm italic">
          {message.highlightedPassage}
        </blockquote>
      )}
      <div
        className={cn(
          'inline-block rounded-lg px-3 py-2 text-left text-sm',
          isUser && 'bg-primary text-primary-foreground',
        )}
      >
        <SummaryProse markdown={message.message} className="text-sm" />
      </div>
    </div>
  );
}

// The widget's Agent tab (#160): a persisted, book-scoped conversation with
// the reading companion, wired to the SSE endpoint from #157. Which thread
// shows tracks the current reader route live, falling back to `lastBookId`
// off a reader route (`useAgentBookId`). Agent threads only ever start via
// highlight-to-discuss (#161) - so with no messages yet this renders no
// freeform composer, only a nudge, until a `pendingHighlight` arrives from
// `ChatWidgetProvider` and is captured as `seededHighlight` (consumed once,
// then cleared from shared state so it does not reseed on a later render).
// Dev builds also keep a manual trigger for a thread with no highlight, for
// testing without the reader page. Real cold-start empty-state polish is
// #162's job.
export function AgentTab() {
  const { getToken } = useAuth();
  const api = useApi();
  const { refetch: refetchUsage } = useUsage();
  const bookId = useAgentBookId();
  const {
    pendingHighlight,
    clearPendingHighlight,
    setIsStreaming,
    isOpen,
    activeTab,
  } = useChatWidget();

  const [phase, setPhase] = useState<Phase>('idle');
  const [messages, setMessages] = useState<AgentMessageDto[]>([]);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<LimitCode | null>(null);
  const [seededHighlight, setSeededHighlight] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keeps the newest text in view as a reply streams in - the panel's own
  // scroll container (`ChatWidget`) is an ancestor of this tab, not
  // something this component owns, so `scrollIntoView` on a trailing
  // sentinel reaches it regardless.
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, streamingReply]);

  // Also jump to the bottom whenever this tab becomes the one showing -
  // switching to it, or reopening the widget while it was already the
  // selected tab - rather than leaving the scroll position wherever it last
  // was (e.g. mid-history, from before the panel was closed).
  useEffect(() => {
    if (!isOpen || activeTab !== 'agent') return;
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (pendingHighlight == null) return;
    setSeededHighlight(pendingHighlight);
    clearPendingHighlight();
  }, [pendingHighlight, clearPendingHighlight]);

  useEffect(() => {
    abortRef.current?.abort();
    setStreamingReply(null);
    setError(null);
    setLimit(null);
    setDraft('');
    setSeededHighlight(null);

    if (!bookId) {
      setMessages([]);
      setPhase('idle');
      return;
    }

    let ignore = false;
    setPhase('loading');
    void (async () => {
      const res = await api(`/api/v1/books/${bookId}/agent-thread`);
      if (ignore) return;
      if (!res.ok) {
        setError((await problemMessage(res)) ?? `load failed: ${res.status}`);
        setPhase('error');
        return;
      }
      const thread = (await res.json()) as AgentThreadDto;
      setMessages(thread.messages);
      setPhase('idle');
    })();

    return () => {
      ignore = true;
    };
  }, [bookId, api]);

  const send = useCallback(
    async (message: string, highlightedPassage?: string) => {
      const trimmed = message.trim();
      if (!trimmed || !bookId) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase('streaming');
      setError(null);
      setLimit(null);
      setStreamingReply('');

      try {
        const token = await getToken();
        const res = await fetch(
          `${env.apiUrl}/api/v1/books/${bookId}/agent-messages`,
          {
            method: 'POST',
            signal: controller.signal,
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            body: JSON.stringify({
              message: trimmed,
              ...(highlightedPassage ? { highlightedPassage } : {}),
            }),
          },
        );

        if (!res.ok || !res.body) {
          const limitCode = await isLimitReached(res);
          if (limitCode) {
            setLimit(limitCode);
            setPhase('idle');
            setStreamingReply(null);
            void refetchUsage();
            return;
          }
          setError((await problemMessage(res)) ?? `send failed: ${res.status}`);
          setPhase('idle');
          setStreamingReply(null);
          return;
        }

        setDraft('');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const event = parseAgentEventFrame(frame);
            if (event) applyEvent(event);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setPhase('idle');
        setStreamingReply(null);
      }

      function applyEvent(event: AgentEvent): void {
        switch (event.type) {
          case 'agent_turn_started':
            setMessages((prev) => [
              ...prev,
              {
                id: event.userMessageId,
                role: 'user',
                message: trimmed,
                highlightedPassage: highlightedPassage ?? null,
                createdAt: new Date().toISOString(),
              },
            ]);
            break;
          case 'agent_text_delta':
            setStreamingReply((prev) => (prev ?? '') + event.text);
            break;
          case 'agent_done':
            setMessages((prev) => [
              ...prev,
              {
                id: event.messageId,
                role: 'assistant',
                message: event.message,
                highlightedPassage: null,
                createdAt: new Date().toISOString(),
              },
            ]);
            setStreamingReply(null);
            setPhase('idle');
            void refetchUsage();
            break;
          case 'agent_error':
            setError(event.message);
            setStreamingReply(null);
            setPhase('idle');
            break;
          default:
            break;
        }
      }
    },
    [bookId, getToken, refetchUsage],
  );

  const busy = phase === 'streaming';
  const hasThread = messages.length > 0;

  // Purely cosmetic: lets the widget's ambient gradient border (index.css)
  // animate faster/brighter while this tab is mid-reply.
  useEffect(() => {
    setIsStreaming(busy);
  }, [busy, setIsStreaming]);

  return (
    <div>
      {!bookId && (
        <p className="text-muted-foreground text-sm">
          Open a book to start a conversation with your reading companion.
        </p>
      )}

      {bookId && phase === 'loading' && (
        <p className="text-muted-foreground text-sm">Loading conversation…</p>
      )}

      {bookId && phase !== 'loading' && (
        <>
          <div className="mb-4 space-y-3">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {streamingReply !== null && (
              <div data-message data-role="assistant" className="text-left">
                <div className="ai-stream-shimmer inline-block rounded-lg px-3 py-2 text-left text-sm">
                  <SummaryProse markdown={streamingReply} className="text-sm" />
                  <span
                    data-testid="agent-reply-caret"
                    aria-hidden="true"
                    className="bg-foreground/70 -mt-1 ml-0.5 inline-block h-4 w-[2px] align-text-bottom motion-safe:animate-caret-blink"
                  />
                </div>
              </div>
            )}
          </div>

          {!hasThread && !seededHighlight && (
            <p className="text-muted-foreground mb-4 text-sm">
              Highlight a passage while reading to start a conversation here.
            </p>
          )}

          {!hasThread && !seededHighlight && env.isDev && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-4 cursor-pointer"
              disabled={busy}
              onClick={() =>
                void send(
                  'What do you make of this?',
                  'To be great is to be misunderstood.',
                )
              }
            >
              Seed test thread (dev only)
            </Button>
          )}

          {limit && <LimitReachedNotice code={limit} />}

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>That message didn&apos;t go through</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {(hasThread || seededHighlight) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const highlightedPassage = seededHighlight ?? undefined;
                setSeededHighlight(null);
                void send(draft, highlightedPassage);
              }}
            >
              {seededHighlight && (
                <blockquote className="ai-highlight-quote bg-muted text-muted-foreground mb-3 block px-3 py-2 text-sm italic">
                  {seededHighlight}
                </blockquote>
              )}
              <Textarea
                rows={2}
                value={draft}
                disabled={busy}
                aria-label="agent message"
                placeholder={
                  seededHighlight ? 'What do you want to know?' : 'Reply...'
                }
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button
                type="submit"
                className="mt-3 cursor-pointer"
                disabled={busy || !draft.trim()}
              >
                {busy ? (
                  <span className="inline-flex items-center gap-1.5">
                    Thinking
                    <ThinkingDots />
                  </span>
                ) : (
                  'Send'
                )}
              </Button>
            </form>
          )}

          {/* Placed after the composer, not just the message list, so
              autoscroll (below) reveals the Send button too - not only the
              latest message text. */}
          <div ref={bottomRef} />
        </>
      )}
    </div>
  );
}
