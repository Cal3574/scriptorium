import { useAuth } from '@clerk/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  type Citation,
  parseQueryEventFrame,
  type QueryEvent,
} from '@scriptorium/contracts';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BackLink } from '@/components/back-link';
import { ScreenHeader } from '@/components/screen-header';
import { AnswerBlock } from '@/components/query/answer-block';
import { CitationList } from '@/components/query/citation-list';
import { QuestionForm } from '@/components/query/question-form';
import { RetrievedPassages } from '@/components/query/retrieved-passages';
import { env } from '../env';
import { problemMessage } from '../books/problem';
import { askAgainPath } from './ask-again';
import { QueryDetail } from './QueryDetail';

type Phase = 'idle' | 'streaming' | 'done' | 'error';

// Ask a natural-language question and get a streamed answer synthesised only
// from passages in your own books, or revisit a past question from history.
// The stream is the POST response body, read with fetch() + a ReadableStream
// reader (not EventSource, which cannot POST or send an Authorization
// header). The `/ask/:queryId` route swaps the ask form for a read-only past
// answer; "Ask again" (from a failed row, or the detail view) navigates to
// `/ask?q=` so the form opens with the question pre-filled. The restyle (#65)
// rebuilt the body from the #54 inventory - QuestionForm, AnswerBlock,
// CitationList, RetrievedPassages - and left the SSE reader untouched.
export function QueryScreen() {
  const { getToken } = useAuth();
  const { queryId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // Seed from `?q=` so the first paint already shows the prefilled question
  // (no empty-textarea flash); the effect below then keeps it in sync when a
  // later "Ask again" navigation changes `?q=` without remounting.
  const [question, setQuestion] = useState(() => searchParams.get('q') ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // "Ask again" lands here with `?q=`; the same component instance is reused
  // across `/ask` and `/ask/:queryId`, so pick the prefill up from the URL
  // and reset the answer view.
  useEffect(() => {
    const prefill = searchParams.get('q');
    if (prefill === null) return;
    setQuestion(prefill);
    setPhase('idle');
    setAnswer('');
    setCitations([]);
    setError(null);
  }, [searchParams]);

  const askAgain = useCallback(
    (prefill: string) => {
      navigate(askAgainPath(prefill));
    },
    [navigate],
  );

  const ask = useCallback(async () => {
    const trimmed = question.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('streaming');
    setAnswer('');
    setCitations([]);
    setError(null);

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
          break;
        case 'error':
          setError(event.message);
          setPhase('error');
          break;
        default:
          break;
      }
    }
  }, [question, getToken]);

  const busy = phase === 'streaming';

  if (queryId) {
    return (
      <section>
        <BackLink to="/history">Back to your questions</BackLink>
        <QueryDetail queryId={queryId} onAskAgain={askAgain} />
      </section>
    );
  }

  return (
    <section>
      <BackLink to="/library">Back to library</BackLink>
      <ScreenHeader title="Ask your library" />

      <QuestionForm
        question={question}
        onQuestionChange={setQuestion}
        onSubmit={() => void ask()}
        busy={busy}
      />

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
    </section>
  );
}
