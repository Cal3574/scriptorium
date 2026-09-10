import { Link } from 'react-router';
import type { ChapterDto } from '@scriptorium/contracts';

import {
  chapterHeading,
  chapterOrdinal,
  pageRange,
} from '@/books/chapter-display';

// BookDetail's chapter index (#118): a plain list of links into the reader,
// one row per chapter in order. Book-detail stopped expanding chapter
// summaries in place - the reader is now the single place to read them, so
// each row deep-links to `/books/:bookId/read/:n`.
export function ChapterList({
  bookId,
  chapters,
}: {
  bookId: string;
  chapters: ChapterDto[];
}) {
  return (
    <ol className="border-border bg-card divide-border m-0 list-none divide-y rounded-lg border p-0">
      {chapters.map((chapter, index) => {
        const number = index + 1;
        const range = pageRange(chapter);
        return (
          <li key={chapter.id}>
            <Link
              to={`/books/${bookId}/read/${number}`}
              className="hover:bg-muted flex items-baseline gap-3 px-4 py-3 no-underline"
            >
              <span className="text-muted-foreground font-mono text-xs">
                {chapterOrdinal(number)}
              </span>
              <span className="text-foreground flex-1 font-serif text-[15px] font-medium">
                {chapterHeading(chapter, number)}
              </span>
              {range && (
                <span className="text-muted-foreground font-mono text-xs whitespace-nowrap">
                  {range}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
