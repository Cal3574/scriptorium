import { Button } from '@/components/ui/button';
import type { DiscussSelectionAction } from './use-discuss-selection';

// `size="sm"` is a fixed 32px (h-8) tall, so this margin (its height plus an
// 8px gap) is exact, not an estimate.
const BUTTON_CLEARANCE_PX = 40;
const VIEWPORT_MARGIN_PX = 8;
// The button's fixed label ("Discuss with AI") gives it a roughly constant
// rendered width; half of that (plus a little slack) bounds how far the
// -translate-x-1/2 centering can push it off either edge of the viewport.
const BUTTON_HALF_WIDTH_PX = 76;

// The floating action for highlight-to-discuss (#161). Positioned in fixed
// coordinates directly from the selection's own bounding rect, so it tracks
// the same viewport-relative frame the browser uses for the selection - no
// scroll-offset math needed. Both axes are clamped so a selection near an
// edge of the viewport still leaves the button fully on-screen and
// clickable, rather than centering it partly or wholly off-screen.
export function DiscussSelectionButton({
  action,
  onDiscuss,
}: {
  action: DiscussSelectionAction | null;
  onDiscuss: (passage: string) => void;
}) {
  if (!action) return null;

  const top = Math.max(action.top - BUTTON_CLEARANCE_PX, VIEWPORT_MARGIN_PX);
  const left = Math.min(
    Math.max(action.left, BUTTON_HALF_WIDTH_PX + VIEWPORT_MARGIN_PX),
    window.innerWidth - BUTTON_HALF_WIDTH_PX - VIEWPORT_MARGIN_PX,
  );

  return (
    <Button
      type="button"
      size="sm"
      className="fixed z-(--z-sheet) -translate-x-1/2 cursor-pointer shadow-lg"
      style={{ top, left }}
      // The browser's default mousedown behavior starts a new selection
      // gesture at the pointer, collapsing the reader's current selection
      // (and, via `selectionchange`, unmounting this button) before `click`
      // ever fires. Suppressing that default is what lets the click reach
      // `onDiscuss` at all.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        window.getSelection()?.removeAllRanges();
        onDiscuss(action.text);
      }}
    >
      Discuss with AI
    </Button>
  );
}
