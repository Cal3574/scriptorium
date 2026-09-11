import { Link } from 'react-router';

import { SummaryProse } from '@/components/prose/summary-prose';
import { Button } from '@/components/ui/button';
import { useReaderBook } from './reader-context';

// `/books/:bookId/read` - the whole-book overview: title, author, the
// whole-book summary as prose, and a "Start reading" link into chapter 1.
// `book.summary` is never null for a `ready` book, so there is no empty state.
export function ReaderOverview() {
  const book = useReaderBook();
  const title = book.title ?? book.originalFilename;
  const firstChapter = book.chapters.length > 0;

  return (
    <article className="mx-auto max-w-[68ch] pb-24">
      {book.author && (
        <p className="text-muted-foreground m-0 font-mono text-[10.5px] tracking-[0.08em] uppercase">
          {book.author}
        </p>
      )}
      <h1 className="text-foreground mt-2 mb-1 font-serif text-2xl leading-tight font-normal">
        {title}
      </h1>
      <p className="text-muted-foreground mb-8 font-mono text-[11px]">
        {book.chapters.length} chapters
      </p>

      {book.summary && <SummaryProse markdown={book.summary} />}

      {firstChapter && (
        <div className="mt-10">
          <Button asChild>
            <Link to={`/books/${book.id}/read/1`}>Start reading</Link>
          </Button>
        </div>
      )}
    </article>
  );
}
