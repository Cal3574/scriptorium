import type { BookStatus } from '@scriptorium/contracts';

import { Badge } from '@/components/ui/badge';
import { ROLE_LABEL, statusRole } from '@/books/status';

// The colour-coded status chip on every book row. A thin wrapper over `Badge`:
// it maps the eight `book_status` values onto the four semantic roles (#54)
// and renders the friendly word in mono, upper-cased.
export function StatusChip({ status }: { status: BookStatus }) {
  const role = statusRole(status);

  return (
    <Badge variant={role} className="uppercase tracking-wide">
      {ROLE_LABEL[role]}
    </Badge>
  );
}
