import type { BookListItemDto } from '@scriptorium/contracts';

import { statusRole } from '@/books/status';
import { ScreenHeader } from '@/components/screen-header';
import { UploadControl } from './upload-control';
import type { useApi } from '@/auth/use-api';

type ApiFetch = ReturnType<typeof useApi>;

// `6 books · 1 working · 1 failed` - the books count is always shown; the
// working / failed segments only when non-zero.
function summarise(books: BookListItemDto[]): string {
  let working = 0;
  let failed = 0;
  for (const book of books) {
    const role = statusRole(book.status);
    if (role === 'working') working += 1;
    if (role === 'failed') failed += 1;
  }
  const parts = [`${books.length} ${books.length === 1 ? 'book' : 'books'}`];
  if (working) parts.push(`${working} working`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(' · ');
}

// The bar above the list (#54): screen name, a mono summary count, and the
// primary upload action. Panel background with the one ambient shadow.
export function Toolbar({
  books,
  api,
  onUploaded,
}: {
  books: BookListItemDto[];
  api: ApiFetch;
  onUploaded: () => void;
}) {
  return (
    <ScreenHeader
      title="Library"
      summary={summarise(books)}
      action={<UploadControl api={api} onUploaded={onUploaded} />}
    />
  );
}
