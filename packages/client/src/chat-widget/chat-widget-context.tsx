import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useMatches } from 'react-router';

type ReaderHandle = { isReaderRoute?: boolean };

export const CHAT_WIDGET_TABS = ['ask-library', 'agent'] as const;
export type ChatWidgetTab = (typeof CHAT_WIDGET_TABS)[number];

interface ChatWidgetContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  activeTab: ChatWidgetTab;
  setActiveTab: (tab: ChatWidgetTab) => void;
  askDraft: string;
  setAskDraft: (value: string) => void;
  // The book id of the most recently visited reader route, live-updated on
  // every navigation while `null` off any reader route so far this session.
  // The Agent tab (#160) falls back to this once the reader route itself is
  // no longer current.
  lastBookId: string | null;
}

const ChatWidgetContext = createContext<ChatWidgetContextValue | null>(null);

// The persistent chat widget's shell state (#159): open/closed, which tab is
// active, an unsent Ask library draft, and the last book read. All in-memory
// component state, not the URL - the widget has no route of its own, so this
// survives client-side navigation for free and resets on a hard reload, per
// the build spec (#156).
export function ChatWidgetProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ChatWidgetTab>('ask-library');
  const [askDraft, setAskDraft] = useState('');
  const [lastBookId, setLastBookId] = useState<string | null>(null);

  // The reader route tree (`routes.tsx`) marks itself via `handle`, so a book
  // id is picked up here from the matched route params rather than
  // re-deriving the route shape from the URL.
  const matches = useMatches();
  const readerBookId = matches.find(
    (m) => (m.handle as ReaderHandle | undefined)?.isReaderRoute,
  )?.params.bookId;
  useEffect(() => {
    if (readerBookId) setLastBookId(readerBookId);
  }, [readerBookId]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  const value = useMemo(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      activeTab,
      setActiveTab,
      askDraft,
      setAskDraft,
      lastBookId,
    }),
    [isOpen, open, close, toggle, activeTab, askDraft, lastBookId],
  );

  return (
    <ChatWidgetContext.Provider value={value}>
      {children}
    </ChatWidgetContext.Provider>
  );
}

export function useChatWidget(): ChatWidgetContextValue {
  const ctx = useContext(ChatWidgetContext);
  if (!ctx) {
    throw new Error('useChatWidget() must be used within <ChatWidgetProvider>');
  }
  return ctx;
}
