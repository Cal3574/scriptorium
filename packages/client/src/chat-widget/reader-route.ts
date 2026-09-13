import type { UIMatch } from 'react-router';

export type ReaderHandle = { isReaderRoute?: boolean };

// Picks the book id off the reader route match, if the current route tree
// includes one. Both `ChatWidgetProvider` (tracking `lastBookId`) and
// `useAgentBookId` (the Agent tab's live "current book") need this same
// lookup, but neither may cache or publish the result as shared context
// state - the build spec (#156) requires "current book" to always be
// derived live from the route. Sharing just the lookup, not the value, keeps
// that guarantee while avoiding two copies of the same `matches.find`.
export function readerBookIdFromMatches(
  matches: UIMatch[],
): string | undefined {
  return matches.find(
    (m) => (m.handle as ReaderHandle | undefined)?.isReaderRoute,
  )?.params.bookId;
}
