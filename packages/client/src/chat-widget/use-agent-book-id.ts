import { useMatches } from 'react-router';
import { useChatWidget } from './chat-widget-context';
import { readerBookIdFromMatches } from './reader-route';

// The Agent tab's current book (#160): the live reader route's book id while
// the reader is on one, else the shell's `lastBookId` fallback. Deliberately
// computed here rather than published as its own field on
// `ChatWidgetProvider` - the build spec (#156) requires "current book" to
// always be derived live from the current route, never separately published
// as its own piece of context state. Re-deriving the reader match (via the
// same `readerBookIdFromMatches` lookup `ChatWidgetProvider` uses for
// `lastBookId`, rather than reusing its result) keeps that guarantee even as
// more consumers show up.
export function useAgentBookId(): string | null {
  const matches = useMatches();
  const { lastBookId } = useChatWidget();
  const readerBookId = readerBookIdFromMatches(matches);
  return readerBookId ?? lastBookId ?? null;
}
