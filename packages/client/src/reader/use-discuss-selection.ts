import { useEffect, useState, type RefObject } from 'react';
import { HIGHLIGHTED_PASSAGE_MAX } from '@scriptorium/contracts';

// Below this (after collapsing whitespace) a selection is too short to be
// worth a conversation - no action shows, rather than seeding the Agent tab
// with a stray word or punctuation mark.
const MIN_LENGTH = 8;

export interface DiscussSelectionAction {
  text: string;
  top: number;
  left: number;
}

// Highlight-to-discuss detection (#161): a native `getSelection` inside
// `containerRef`, with no custom selection layer. Multi-paragraph selections
// are flattened to plain text; a below-minimum or collapsed selection (or one
// that starts/ends outside the container) hides the action, while an
// over-length one is truncated to `HIGHLIGHTED_PASSAGE_MAX` (the backend's
// own bound, #157) rather than rejected.
export function useDiscussSelection(
  containerRef: RefObject<HTMLElement | null>,
): DiscussSelectionAction | null {
  const [action, setAction] = useState<DiscussSelectionAction | null>(null);

  useEffect(() => {
    function handleSelectionChange(): void {
      const container = containerRef.current;
      const selection = window.getSelection();
      if (
        !container ||
        !selection ||
        selection.isCollapsed ||
        selection.rangeCount === 0
      ) {
        setAction(null);
        return;
      }

      const range = selection.getRangeAt(0);
      if (
        !container.contains(range.startContainer) ||
        !container.contains(range.endContainer)
      ) {
        setAction(null);
        return;
      }

      const flattened = selection.toString().replace(/\s+/g, ' ').trim();
      if (flattened.length < MIN_LENGTH) {
        setAction(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      setAction({
        text: flattened.slice(0, HIGHLIGHTED_PASSAGE_MAX),
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    }

    document.addEventListener('selectionchange', handleSelectionChange);
    return () =>
      document.removeEventListener('selectionchange', handleSelectionChange);
  }, [containerRef]);

  return action;
}
