import type { BookListItemDto } from '@scriptorium/contracts';

import { statusRole, type StatusRole } from './status';

// The library's default order (UI polish spec). The server returns books
// newest-first; the worklist re-sorts so the rows that need attention rise:
// anything still ingesting first, then failures, then the queued backlog,
// then the settled `ready` shelf, with a row mid-delete sinking out of the
// way. Ties break on `createdAt`, newest first - a fresh upload lands at the
// top of its band.
const ROLE_RANK: Record<StatusRole, number> = {
  working: 0,
  failed: 1,
  queued: 2,
  ready: 3,
  deleting: 4,
};

export function sortBooks(books: BookListItemDto[]): BookListItemDto[] {
  return [...books].sort((a, b) => {
    const byRole =
      ROLE_RANK[statusRole(a.status)] - ROLE_RANK[statusRole(b.status)];
    if (byRole !== 0) return byRole;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
