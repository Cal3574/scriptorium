import { useAuth } from '@clerk/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import Markdown from 'react-markdown';
import {
  type Citation,
  parseQueryEventFrame,
  type QueryEvent,
} from '@scriptorium/contracts';
import { env } from '../env';
import { MUTED, problemMessage } from '../books/problem';
import { askAgainPath } from './ask-again';
import { QueryDetail } from './QueryDetail';

type Phase = 'idle' | 'streaming' | 'done' | 'error';

// Ask a natural-language question and get a streamed answer synthesised only
// from passages in your own books, or revisit a past question from history.
// The stream is the POST response body, read with fetch() + a ReadableStream
// reader (not EventSource, which cannot POST or send an Authorization
// header). The `/ask/:queryId` route swaps the ask form for a read-only past
// answer; "Ask again" (from a failed row, or the detail view) navigates to
// `/ask?q=` so the form opens with the question pre-filled.
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
        <Link to="/history">&larr; Back to your library of questions</Link>
        <QueryDetail queryId={queryId} onAskAgain={askAgain} />
      </section>
    );
  }

  return (
    <section>
      <Link to="/library">&larr; Back to library</Link>
      <h2>Ask your library</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <textarea
          rows={3}
          value={question}
          disabled={busy}
          aria-label="question"
          placeholder="What do these authors say about..."
          onChange={(e) => setQuestion(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        <button type="submit" disabled={busy || !question.trim()}>
          {busy ? 'Thinking...' : 'Ask'}
        </button>
      </form>

      {error && <p role="alert">{error}</p>}

      {(answer || phase === 'done') && (
        <article data-answer>
          <Markdown>{answer}</Markdown>
        </article>
      )}

      {citations.length > 0 && (
        <>
          <h3>Citations</h3>
          <ol data-citations>
            {citations.map((c) => (
              <li key={c.chunkId} value={c.marker}>
                {c.bookTitle} - {c.chapterTitle}
              </li>
            ))}
          </ol>

          <h3>Retrieved passages</h3>
          <ul data-passages style={{ listStyle: 'none', paddingLeft: 0 }}>
            {citations.map((c) => (
              <li key={c.chunkId} style={{ marginBottom: '1rem' }}>
                <strong>
                  [{c.marker}] {c.bookTitle} - {c.chapterTitle}
                </strong>
                <blockquote style={{ color: MUTED, marginLeft: 0 }}>
                  {c.chunkText}
                </blockquote>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
