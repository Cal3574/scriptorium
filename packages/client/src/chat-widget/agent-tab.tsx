import { useAuth } from '@clerk/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useMatches } from 'react-router';
import { BookOpenIcon, SparklesIcon } from 'lucide-react';
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
import { queryQuotaExhausted, useUsage } from '../usage/use-usage';
import { LimitReachedNotice } from '../usage/limit-reached-notice';
import { useAgentBookId } from './use-agent-book-id';
import { readerBookIdFromMatches } from './reader-route';
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
        {isUser ? (
          // Plain text, not markdown: `.prose` (index.css) hardcodes its own
          // foreground/link/quote colors, tuned for a card/background
          // surface - against this bubble's `bg-primary` they read as
          // low-contrast or invisible in several themes. The user's own
          // typed text was never markdown source anyway.
          <span className="whitespace-pre-wrap">{message.message}</span>
        ) : (
          <SummaryProse markdown={message.message} className="text-sm" />
        )}
      </div>
    </div>
  );
}

// Shared "AI surface" avatar for the Agent tab's empty states (#162): the
// same glow-ring treatment as the launcher (index.css), scaled down, so the
// widget reads as one visual identity whether it's closed, idle, or empty.
function EmptyAvatar() {
  return (
    <div className="ai-empty-avatar bg-card mb-4 flex size-10 items-center justify-center rounded-full">
      <SparklesIcon className="text-primary size-5" aria-hidden="true" />
    </div>
  );
}

// No book in context and no `lastBookId` yet this session - the reader has
// never opened a book, so there's nothing to discuss and nowhere to jump
// back to.
function NoBookEmptyState() {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <EmptyAvatar />
      <h3 className="ai-shimmer-text font-serif text-lg">
        Nothing to discuss yet
      </h3>
      <p className="text-muted-foreground mt-2 mb-5 max-w-[26ch] text-sm">
        Agent conversations start from something you highlight while reading.
        Open a book and select a passage to begin.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link to="/library">
          <BookOpenIcon className="size-4" />
          Go to library
        </Link>
      </Button>
    </div>
  );
}

// A book is in context (live reader route or `lastBookId`) but no thread has
// started yet. The copy and CTA differ depending on whether the reader is
// still on that book's reader route: on the page, the nudge points at the
// highlight-to-discuss action right there; off the page, it offers a way
// back in since there's nothing to highlight from here.
function NoThreadEmptyState({
  bookId,
  onReader,
}: {
  bookId: string;
  onReader: boolean;
}) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <EmptyAvatar />
      <h3 className="ai-shimmer-text font-serif text-lg">
        Start a conversation
      </h3>
      {onReader ? (
        <p className="text-muted-foreground mt-2 max-w-[28ch] text-sm">
          Select a passage on this page and choose &ldquo;Discuss with AI&rdquo;
          to start talking about it.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground mt-2 mb-5 max-w-[28ch] text-sm">
            You haven&apos;t started a conversation about this book yet.
            Highlight a passage while reading to begin.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link to={`/books/${bookId}/read`}>
              <BookOpenIcon className="size-4" />
              Continue reading
            </Link>
          </Button>
        </>
      )}
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
// testing without the reader page. The three cold-start empty states (#162)
// - no book at all, a book with no thread yet, and a live thread - use the
// same "AI surface" glow/shimmer identity as the rest of the widget.
export function AgentTab() {
  const { getToken } = useAuth();
  const api = useApi();
  const { usage, refetch: refetchUsage } = useUsage();
  const bookId = useAgentBookId();
  const onReader = readerBookIdFromMatches(useMatches()) === bookId;
  const {
    pendingHighlight,
    clearPendingHighlight,
    setIsStreaming,
    isOpen,
    activeTab,
    close,
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

  // Proactive, from the already-fetched pooled allowance - see
  // `ask-library-tab.tsx` for the same derivation.
  const quotaExhausted = queryQuotaExhausted(usage);
  const bannerCode = limit ?? (quotaExhausted ? 'query_limit_reached' : null);

  // Keeps the newest text in view as a reply streams in - the panel's own
  // scroll container (`ChatWidget`) is an ancestor of this tab, not
  // something this component owns, so `scrollIntoView` on a trailing
  // sentinel reaches it regardless. Also fires when `seededHighlight`
  // changes, since seeding a long highlight into the composer can otherwise
  // leave the Send button below the fold with no scroll to reveal it.
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, streamingReply, seededHighlight]);

  // Also jump to the bottom whenever this tab becomes the one showing -
  // switching to it, or reopening the widget while it was already the
  // selected tab - rather than leaving the scroll position wherever it last
  // was (e.g. mid-history, from before the panel was closed).
  useEffect(() => {
    if (!isOpen || activeTab !== 'agent') return;
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [isOpen, activeTab]);

  // Resets per-book state whenever the shown book changes (including to
  // none). This runs in the same commit as the pendingHighlight-consuming
  // effect below on the very first mount with a highlight already pending
  // (the widget's first-ever open via highlight-to-discuss, where bookId
  // and pendingHighlight are both already set) - so `setSeededHighlight`
  // here must stay declared before that effect, not after, or this reset
  // would run second and clobber the highlight it just seeded.
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

  useEffect(() => {
    if (pendingHighlight == null) return;
    setSeededHighlight(pendingHighlight);
    clearPendingHighlight();
  }, [pendingHighlight, clearPendingHighlight]);

  const send = useCallback(
    async (message: string, highlightedPassage?: string) => {
      const trimmed = message.trim();
      if (!trimmed || !bookId || quotaExhausted) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase('streaming');
      setError(null);
      setLimit(null);
      setStreamingReply('');
      // Flipped by applyEvent on a terminal (agent_done/agent_error) frame -
      // declared up here, not inside the try block below, so both the
      // post-loop check and applyEvent (a sibling function, not nested in
      // the try) can see it.
      let settled = false;

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

        // The stream can end (a dropped connection, an idle-timeout proxy)
        // without ever sending a terminal agent_done/agent_error frame - if
        // so, applyEvent never flipped `settled`, and phase/streamingReply
        // would otherwise be stuck mid-turn with no way out for the user.
        if (!settled) {
          setError('The connection to the agent was lost.');
          setPhase('idle');
          setStreamingReply(null);
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
            settled = true;
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
            settled = true;
            setError(event.message);
            setStreamingReply(null);
            setPhase('idle');
            break;
          default:
            break;
        }
      }
    },
    [bookId, getToken, refetchUsage, quotaExhausted],
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
      {!bookId && <NoBookEmptyState />}

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
            <NoThreadEmptyState bookId={bookId} onReader={onReader} />
          )}

          {!hasThread && !seededHighlight && env.isDev && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-4 cursor-pointer"
              disabled={busy || quotaExhausted}
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

          {bannerCode && (
            <LimitReachedNotice code={bannerCode} onUpgradeClick={close} />
          )}

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
                disabled={busy || quotaExhausted}
                aria-label="agent message"
                placeholder={
                  seededHighlight ? 'What do you want to know?' : 'Reply...'
                }
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button
                type="submit"
                className="mt-3 cursor-pointer"
                disabled={busy || quotaExhausted || !draft.trim()}
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
