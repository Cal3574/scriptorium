import { Link } from 'react-router';
import type { ActivityTopBookDto } from '@scriptorium/contracts';

// The "most-asked books" panel: up to five books ranked by how many
// book-filtered questions the reader has put to them, each row a link to that
// book. Unfiltered questions and questions against deleted books never reach
// here (the server drops them), so an empty list means "no book-scoped
// questions yet".
export function TopBooks({ books }: { books: ActivityTopBookDto[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-foreground font-serif text-sm font-semibold">
        Most-asked books
      </h2>

      {books.length === 0 ? (
        <p className="text-muted-foreground border-border bg-card rounded-lg border px-4 py-6 text-sm">
          Ask a question about a book and it will show up here.{' '}
          <Link to="/ask" className="text-primary font-medium hover:underline">
            Ask something
          </Link>
        </p>
      ) : (
        <ol className="border-border bg-card divide-border divide-y overflow-hidden rounded-lg border">
          {books.map((book, index) => (
            <li key={book.bookId}>
              <Link
                to={`/books/${book.bookId}`}
                className="hover:bg-accent/40 flex items-center gap-3 px-4 py-2.5 no-underline"
              >
                <span className="text-muted-foreground w-4 font-mono text-xs tabular-nums">
                  {index + 1}
                </span>
                <span className="text-foreground min-w-0 flex-1 truncate font-serif text-[15px] leading-tight font-medium">
                  {book.title}
                </span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {book.questionCount}{' '}
                  {book.questionCount === 1 ? 'question' : 'questions'}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
