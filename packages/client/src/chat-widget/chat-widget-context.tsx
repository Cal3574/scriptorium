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
import { readerBookIdFromMatches } from './reader-route';

export const CHAT_WIDGET_TABS = ['ask-library', 'agent'] as const;
export type ChatWidgetTab = (typeof CHAT_WIDGET_TABS)[number];

// Shared between the desktop floating panel and the mobile full-bleed
// takeover (#164) - both render the same mode tabs, just inside different
// chrome, so the copy lives in one place rather than two.
export const CHAT_WIDGET_TAB_LABEL: Record<ChatWidgetTab, string> = {
  'ask-library': 'Ask library',
  agent: 'Agent',
};

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
  // A passage seeded by highlight-to-discuss (#161), consumed once by the
  // Agent tab and then cleared - not a durable draft like `askDraft`, since
  // it exists only to hand a fresh selection across from the reader page.
  pendingHighlight: string | null;
  seedHighlight: (passage: string) => void;
  clearPendingHighlight: () => void;
  // Whichever tab is mid-reply sets this so the panel's ambient gradient
  // border (the "AI" visual language) can animate faster/brighter - purely
  // cosmetic, not read by either tab's own logic.
  isStreaming: boolean;
  setIsStreaming: (value: boolean) => void;
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
  const [pendingHighlight, setPendingHighlight] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  // The reader route tree (`routes.tsx`) marks itself via `handle`, so a book
  // id is picked up here from the matched route params rather than
  // re-deriving the route shape from the URL.
  const matches = useMatches();
  const readerBookId = readerBookIdFromMatches(matches);
  useEffect(() => {
    if (readerBookId) setLastBookId(readerBookId);
  }, [readerBookId]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const clearPendingHighlight = useCallback(
    () => setPendingHighlight(null),
    [],
  );
  // Highlight-to-discuss (#161) always wins immediately - no confirmation
  // step, even if the widget was already open on a different tab.
  const seedHighlight = useCallback((passage: string) => {
    setPendingHighlight(passage);
    setActiveTab('agent');
    setIsOpen(true);
  }, []);

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
      pendingHighlight,
      seedHighlight,
      clearPendingHighlight,
      isStreaming,
      setIsStreaming,
    }),
    [
      isOpen,
      open,
      close,
      toggle,
      activeTab,
      askDraft,
      lastBookId,
      pendingHighlight,
      seedHighlight,
      clearPendingHighlight,
      isStreaming,
    ],
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
