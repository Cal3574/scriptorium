import { Button } from '@/components/ui/button';
import type { DiscussSelectionAction } from './use-discuss-selection';

// `size="sm"` is a fixed 32px (h-8) tall, so this margin (its height plus an
// 8px gap) is exact, not an estimate.
const BUTTON_CLEARANCE_PX = 40;
const VIEWPORT_MARGIN_PX = 8;

// The floating action for highlight-to-discuss (#161). Positioned in fixed
// coordinates directly from the selection's own bounding rect, so it tracks
// the same viewport-relative frame the browser uses for the selection - no
// scroll-offset math needed. The vertical position is clamped so a selection
// near the top of the viewport still leaves the button on-screen, rather
// than floating above it unclickable.
export function DiscussSelectionButton({
  action,
  onDiscuss,
}: {
  action: DiscussSelectionAction | null;
  onDiscuss: (passage: string) => void;
}) {
  if (!action) return null;

  const top = Math.max(action.top - BUTTON_CLEARANCE_PX, VIEWPORT_MARGIN_PX);

  return (
    <Button
      type="button"
      size="sm"
      className="fixed z-(--z-sheet) -translate-x-1/2 cursor-pointer shadow-lg"
      style={{ top, left: action.left }}
      onClick={() => {
        window.getSelection()?.removeAllRanges();
        onDiscuss(action.text);
      }}
    >
      Discuss with AI
    </Button>
  );
}
