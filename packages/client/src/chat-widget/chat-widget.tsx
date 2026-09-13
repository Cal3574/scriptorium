import { MessageCircleIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useChatWidget, type ChatWidgetTab } from './chat-widget-context';
import { AskLibraryTab } from './ask-library-tab';

const TAB_LABEL: Record<ChatWidgetTab, string> = {
  'ask-library': 'Ask library',
  agent: 'Agent',
};

// The persistent chat widget (#159): a launcher visible on every top-level
// screen, and - when open - a floating panel with a manual tab switcher.
// Both tabs stay mounted once the widget has opened once, hidden rather than
// unmounted when inactive/closed, so an in-flight Ask library answer (or,
// later, an Agent thread) survives a tab switch or the panel closing. The
// panel has no route of its own; `AppShell` renders it as an overlay sibling
// of the routed `<Outlet>` so it persists across client-side navigation.
export function ChatWidget() {
  const { isOpen, close, toggle, activeTab, setActiveTab } = useChatWidget();

  return (
    <>
      <Button
        type="button"
        size="icon-lg"
        className="fixed right-6 bottom-6 z-(--z-sheet) rounded-full shadow-lg"
        aria-label="Toggle chat widget"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        {isOpen ? <XIcon /> : <MessageCircleIcon />}
      </Button>

      <section
        aria-label="Chat widget"
        hidden={!isOpen}
        className="bg-card text-card-foreground border-border fixed right-6 bottom-24 z-(--z-sheet) flex h-[min(32rem,70dvh)] w-[min(24rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-lg border shadow-xl"
      >
        <header className="border-border flex items-center justify-between border-b px-2 pt-2">
          <div
            role="tablist"
            aria-label="Chat widget mode"
            className="flex gap-1"
          >
            {(['ask-library', 'agent'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'rounded-t-md px-3 py-2 text-sm font-medium',
                  activeTab === tab
                    ? 'border-primary text-foreground border-b-2'
                    : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent',
                )}
              >
                {TAB_LABEL[tab]}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close chat widget"
            onClick={close}
          >
            <XIcon />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <div hidden={activeTab !== 'ask-library'}>
            <AskLibraryTab />
          </div>
          <div hidden={activeTab !== 'agent'}>
            <p className="text-muted-foreground text-sm">
              The Agent tab is coming soon.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
