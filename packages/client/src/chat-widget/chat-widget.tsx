import { SparklesIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  CHAT_WIDGET_TABS,
  CHAT_WIDGET_TAB_LABEL,
  useChatWidget,
} from './chat-widget-context';
import { AskLibraryTab } from './ask-library-tab';
import { AgentTab } from './agent-tab';
import { useIsMobileViewport } from './use-mobile-viewport';
import { useWidgetBackClose } from './use-widget-back-close';

// The persistent chat widget (#159): a launcher visible on every top-level
// screen, and - when open - a panel with a manual tab switcher. Below the
// `md` breakpoint (`useIsMobileViewport`, the same split `TopBar`/`MobileNav`
// already use) that panel is a dedicated full-bleed takeover (#164) instead
// of the floating panel at or above it - own chrome, own z-layer
// (`--z-widget-takeover`, index.css: above every other overlay, below
// toasts), a slide-up-from-bottom entrance, and the device back
// button/gesture closes it instead of navigating the underlying app
// (`useWidgetBackClose`, a synthetic history entry scoped to exactly this
// state so desktop's floating panel never touches history). It is a bespoke
// overlay, not an adaptation of the shared `Sheet` component, which is
// width-capped and wrong for this.
//
// Both variants render from this one mounted tree - the header and the tab
// content differ only in a handful of conditional classes, not in separate
// components - so resizing across the breakpoint while the widget is open
// (a devtools resize, a foldable unfolding) never remounts `AskLibraryTab`/
// `AgentTab` and loses an in-flight answer. Both tabs stay mounted once the
// widget has opened once, hidden rather than unmounted when inactive/closed,
// so an in-flight Ask library answer or Agent reply survives a tab switch or
// the panel closing either way. The panel has no route of its own; `AppShell`
// renders it as an overlay sibling of the routed <Outlet> so it persists
// across client-side navigation.
//
// The launcher's idle glow (a spinning conic aura, a pulsing ring, and a
// scatter of twinkling sparkles) and the desktop panel's gradient border +
// bloom are the widget's "AI" visual language (#166, index.css) - inviting
// the first open, and brightening/quickening while either tab is mid-reply
// (`isStreaming`, set by whichever tab is actually streaming).
export function ChatWidget() {
  const { isOpen, close, toggle, activeTab, setActiveTab, isStreaming } =
    useChatWidget();
  const isMobile = useIsMobileViewport();

  useWidgetBackClose(isOpen && isMobile, close);

  return (
    <>
      <div className="fixed right-6 bottom-6 z-(--z-sheet)">
        <Button
          type="button"
          size="icon-lg"
          className={cn(
            'relative cursor-pointer rounded-full shadow-lg',
            !isOpen && 'ai-launcher-glow',
          )}
          aria-label="Toggle chat widget"
          aria-expanded={isOpen}
          onClick={toggle}
        >
          {isOpen ? <XIcon /> : <SparklesIcon />}
        </Button>
        {!isOpen && (
          <>
            <span
              aria-hidden="true"
              className="ai-sparkle"
              style={{ top: -10, left: 2 }}
            />
            <span
              aria-hidden="true"
              className="ai-sparkle [animation-delay:0.8s]"
              style={{ top: 8, right: -10 }}
            />
            <span
              aria-hidden="true"
              className="ai-sparkle [animation-delay:1.6s]"
              style={{ bottom: -8, left: -6 }}
            />
          </>
        )}
      </div>

      <div
        hidden={!isOpen}
        data-testid={isMobile ? 'mobile-widget-takeover' : undefined}
        data-active={isStreaming || undefined}
        className={cn(
          'fixed',
          isMobile
            ? 'inset-0 z-(--z-widget-takeover) animate-in slide-in-from-bottom duration-300'
            : 'ai-panel-glow right-6 bottom-24 z-(--z-sheet) h-[min(32rem,70dvh)] w-[min(24rem,calc(100vw-3rem))] rounded-lg p-px shadow-xl',
        )}
      >
        <section
          aria-label="Chat widget"
          className={cn(
            'bg-card text-card-foreground flex h-full w-full flex-col overflow-hidden',
            !isMobile && 'rounded-[calc(var(--radius-lg)-1px)]',
          )}
        >
          <header className="border-border flex items-center justify-between border-b px-2 pt-2">
            <div
              role="tablist"
              aria-label="Chat widget mode"
              className="flex gap-1"
            >
              {CHAT_WIDGET_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    'cursor-pointer rounded-t-md px-3 py-2 text-sm font-medium',
                    activeTab === tab
                      ? 'ai-tab-glow border-primary text-foreground border-b-2'
                      : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent',
                  )}
                >
                  {CHAT_WIDGET_TAB_LABEL[tab]}
                </button>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="cursor-pointer"
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
              <AgentTab />
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
