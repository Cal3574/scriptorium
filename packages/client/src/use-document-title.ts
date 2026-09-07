import { useEffect } from 'react';
import { useMatches } from 'react-router';

const SITE = 'Scriptorium';

type TitleHandle = { title?: string };

// Drives `document.title` from the matched route's `handle.title` (set in
// routes.tsx). The deepest match that declares one wins, so a nested screen
// can override its parent. A screen with a data-dependent title (a book name,
// say) declares no `handle.title` and calls `setDocumentTitle` itself once
// the data lands.
export function useDocumentTitle(): void {
  const matches = useMatches();
  const routeTitle = [...matches]
    .reverse()
    .map((m) => (m.handle as TitleHandle | undefined)?.title)
    .find(Boolean);

  useEffect(() => {
    // A route without its own title (e.g. book detail) is left alone here -
    // that screen sets and clears the title itself.
    if (routeTitle) setDocumentTitle(routeTitle);
  }, [routeTitle]);
}

// `undefined` -> just the site name. Otherwise `<page> · Scriptorium`.
export function setDocumentTitle(page?: string): void {
  document.title = page ? `${page} · ${SITE}` : SITE;
}
