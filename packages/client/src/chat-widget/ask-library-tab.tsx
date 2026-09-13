import { useAuth } from '@clerk/react';
import { useCallback, useRef, useState } from 'react';
import {
  type Citation,
  parseQueryEventFrame,
  type QueryEvent,
} from '@scriptorium/contracts';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AnswerBlock } from '@/components/query/answer-block';
import { CitationList } from '@/components/query/citation-list';
import { QuestionForm } from '@/components/query/question-form';
import { RetrievedPassages } from '@/components/query/retrieved-passages';
import { env } from '../env';
import {
  isLimitReached,
  problemMessage,
  type LimitCode,
} from '../books/problem';
import { useUsage } from '../usage/use-usage';
import { LimitReachedNotice } from '../usage/limit-reached-notice';
import { useChatWidget } from './chat-widget-context';

type Phase = 'idle' | 'streaming' | 'done' | 'error';

// The widget's Ask library tab (#159): today's `/ask` one-shot Q&A
// (`QueryScreen`), relocated into the widget and made functionally
// identical - same POST + SSE stream against `/api/v1/queries`, same
// answer/citations/passages rendering, same limit-reached handling. The
// question itself is the shared `askDraft` on `ChatWidgetProvider` (not local
// state) so a prefill action (#165) can seed it from outside this component;
// everything else (phase/answer/citations/error/limit) is local, since this
// tab stays mounted for the widget's lifetime and so keeps an in-flight
// answer even if the panel is closed and reopened.
export function AskLibraryTab() {
  const { getToken } = useAuth();
  const { refetch: refetchUsage } = useUsage();
  const { askDraft, setAskDraft } = useChatWidget();
  const [phase, setPhase] = useState<Phase>('idle');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<LimitCode | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(async () => {
    const trimmed = askDraft.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('streaming');
    setAnswer('');
    setCitations([]);
    setError(null);
    setLimit(null);

    try {
      const token = await getToken();
      const res = await fetch(`${env.apiUrl}/api/v1/queries`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!res.ok || !res.body) {
        // A 402 means the monthly question quota is spent. This tab uses raw
        // `fetch`, not `useApi`, so the usage bus was not pinged - refetch
        // the meter here, and show the shared notice instead of an error.
        const limitCode = await isLimitReached(res);
        if (limitCode) {
          setLimit(limitCode);
          setPhase('error');
          void refetchUsage();
          return;
        }
        setError((await problemMessage(res)) ?? `query failed: ${res.status}`);
        setPhase('error');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line. Keep the trailing partial.
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const event = parseQueryEventFrame(frame);
          if (event) applyEvent(event);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }

    function applyEvent(event: QueryEvent): void {
      switch (event.type) {
        case 'citations':
          setCitations(event.citations);
          break;
        case 'text_delta':
          setAnswer((prev) => prev + event.text);
          break;
        case 'done':
          setAnswer(event.answer);
          setPhase('done');
          // A completed query stream spent one question: refresh the meter.
          void refetchUsage();
          break;
        case 'error':
          setError(event.message);
          setPhase('error');
          break;
        default:
          break;
      }
    }
  }, [askDraft, getToken, refetchUsage]);

  const busy = phase === 'streaming';

  return (
    <div>
      <QuestionForm
        question={askDraft}
        onQuestionChange={setAskDraft}
        onSubmit={() => void ask()}
        busy={busy}
      />

      {phase === 'idle' && !answer && !error && !limit && (
        <p className="text-muted-foreground mb-6 text-sm">
          Ask a question and get an answer grounded in citations from every book
          in your library.
        </p>
      )}

      {limit && <LimitReachedNotice code={limit} />}

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>That question didn&apos;t go through</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {(answer || phase === 'done') && (
        <AnswerBlock markdown={answer} streaming={phase === 'streaming'} />
      )}

      {citations.length > 0 && (
        <div className="mt-8 space-y-6">
          <div>
            <h2 className="text-foreground mb-2 font-serif text-lg font-semibold">
              Citations
            </h2>
            <CitationList
              citations={citations.map((c) => ({
                key: c.chunkId,
                marker: c.marker,
                bookTitle: c.bookTitle,
                chapterTitle: c.chapterTitle,
              }))}
            />
          </div>

          <RetrievedPassages
            passages={citations.map((c) => ({
              key: c.chunkId,
              marker: c.marker,
              bookTitle: c.bookTitle,
              chapterTitle: c.chapterTitle,
              chunkText: c.chunkText,
            }))}
          />
        </div>
      )}
    </div>
  );
}
