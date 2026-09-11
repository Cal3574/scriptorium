import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { BookOpenIcon } from 'lucide-react';
import type { BookDetailDto, BookDto } from '@scriptorium/contracts';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { BackLink } from '@/components/back-link';
import { ScreenHeader } from '@/components/screen-header';
import { SummaryProse } from '@/components/prose/summary-prose';
import { FailedBookBanner } from '@/components/library/failed-book-banner';
import { ChapterList } from '@/components/book-detail/chapter-list';
import { EditableField } from '@/components/book-detail/editable-field';
import { NotGeneratedYet } from '@/components/book-detail/not-generated-yet';
import { IngestTimeline } from '@/components/ingest/ingest-timeline';
import { useApi } from '../auth/use-api';
import { setDocumentTitle } from '../use-document-title';
import { problemMessage } from './problem';
import { useIngestEvents } from './use-ingest-events';

const TERMINAL: ReadonlySet<string> = new Set(['ready', 'failed']);

// The Book-detail screen (#64, #139): the whole-book summary as readable prose,
// a plain chapter list linking into the reader, inline correction of a wrong
// title or author wired to `PATCH /books/:id`, and the same plain-language
// failure + retry and live status the library row shows. `bookId` comes from
// the `/books/:bookId` route; "back" is a link to the library, not a callback.
export function BookDetail() {
  const { bookId = '' } = useParams();
  const api = useApi();
  const [book, setBook] = useState<BookDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api(`/api/v1/books/${bookId}`);
    if (!res.ok) {
      throw new Error(
        (await problemMessage(res)) ?? `load failed: ${res.status}`,
      );
    }
    setBook((await res.json()) as BookDetailDto);
  }, [api, bookId]);

  useEffect(() => {
    setBook(null);
    setError(null);
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  // No `handle.title` for this route - the title is the book itself. Reset to
  // the bare site name on unmount so a stale book name never lingers.
  useEffect(() => {
    if (book?.title) setDocumentTitle(book.title);
    return () => setDocumentTitle();
  }, [book?.title]);

  // While the book is mid-pipeline (including straight after a retry) follow
  // the live progress stream; when it settles, refetch the detail so the
  // summaries and any new failure state land.
  const live = book != null && !TERMINAL.has(book.status);
  const { progress, connected } = useIngestEvents(bookId, live);

  useEffect(() => {
    if (live && progress && TERMINAL.has(progress.status)) {
      load().catch((err: Error) => setError(err.message));
    }
  }, [live, progress, load]);

  const retry = useCallback(async () => {
    const res = await api(`/api/v1/books/${bookId}/retry`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(
        (await problemMessage(res)) ?? `retry failed: ${res.status}`,
      );
    }
    // Book is `pending` again; reload drops the banner and the effect above
    // re-subscribes to the live stream. Never auto-retried.
    await load();
  }, [api, bookId, load]);

  // One PATCH key at a time - the screen only ever edits a single field. The
  // body carries exactly that key, so `author: null` (a clear) is sent as
  // such while an untouched field is never mentioned.
  const patch = useCallback(
    async (body: { title: string } | { author: string | null }) => {
      const res = await api(`/api/v1/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(
          (await problemMessage(res)) ?? `update failed: ${res.status}`,
        );
      }
      const updated = (await res.json()) as BookDto;
      setBook((prev) =>
        prev ? { ...prev, title: updated.title, author: updated.author } : prev,
      );
    },
    [api, bookId],
  );

  if (error) {
    return (
      <section>
        <BackLink to="/library">Back to library</BackLink>
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load this book</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </section>
    );
  }

  if (!book) {
    return (
      <section>
        <BackLink to="/library">Back to library</BackLink>
        <BookDetailSkeleton />
      </section>
    );
  }

  const displayTitle = book.title ?? book.originalFilename;

  return (
    <section>
      <BackLink to="/library">Back to library</BackLink>
      <ScreenHeader title={displayTitle}>
        {book.status === 'ready' && (
          <Button asChild size="sm">
            <Link to={`/books/${book.id}/read`}>
              <BookOpenIcon />
              Read
            </Link>
          </Button>
        )}
      </ScreenHeader>

      {book.status === 'failed' && (
        <FailedBookBanner
          failedStage={book.failedStage}
          failureReason={book.failureReason}
          onRetry={retry}
        />
      )}
      {live && (
        <div className="border-border bg-card mb-6 rounded-lg border p-4">
          <IngestTimeline
            book={book}
            progress={progress}
            connected={connected}
            onRetry={retry}
          />
        </div>
      )}

      <dl className="mb-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground font-mono text-xs tracking-wide uppercase">
          Title
        </dt>
        <dd className="m-0">
          <EditableField
            label="title"
            value={book.title}
            placeholder={book.originalFilename}
            nullable={false}
            onSave={(next) => patch({ title: next as string })}
          />
        </dd>
        <dt className="text-muted-foreground font-mono text-xs tracking-wide uppercase">
          Author
        </dt>
        <dd className="m-0">
          <EditableField
            label="author"
            value={book.author}
            placeholder="Unknown author"
            nullable
            onSave={(next) => patch({ author: next })}
          />
        </dd>
      </dl>

      <h2 className="text-foreground mb-3 font-serif text-lg font-semibold">
        Summary
      </h2>
      {book.summary ? (
        <SummaryProse markdown={book.summary} />
      ) : (
        <NotGeneratedYet />
      )}

      <Separator className="my-8" />

      <h2 className="text-foreground mb-3 font-serif text-lg font-semibold">
        Chapters
      </h2>
      {book.chapters.length === 0 ? (
        <NotGeneratedYet what="chapters" />
      ) : (
        <ChapterList bookId={book.id} chapters={book.chapters} />
      )}
    </section>
  );
}

// The load placeholder: the header, the metadata rows and a block of summary
// lines as `Skeleton` bars, so the screen does not flash empty then full
// (user story 56).
function BookDetailSkeleton() {
  return (
    <div data-testid="book-detail-skeleton">
      <Skeleton className="mb-6 h-8 w-2/3" />
      <div className="mb-8 space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="mb-3 h-6 w-32" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}
