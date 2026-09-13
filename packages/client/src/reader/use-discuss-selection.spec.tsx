import { useRef } from 'react';
import { render, cleanup, act, screen } from '@testing-library/react';
import { HIGHLIGHTED_PASSAGE_MAX } from '@scriptorium/contracts';
import { useDiscussSelection } from './use-discuss-selection';

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const action = useDiscussSelection(ref);
  return (
    <div>
      <div ref={ref} data-testid="container">
        <p>text inside the container</p>
      </div>
      <p data-testid="outside">text outside the container</p>
      <span data-testid="action-text">{action ? action.text : 'none'}</span>
      <span data-testid="action-top">{action ? action.top : 'none'}</span>
      <span data-testid="action-left">{action ? action.left : 'none'}</span>
    </div>
  );
}

function fakeSelection(overrides: {
  text: string;
  startNode: Node;
  endNode?: Node;
  isCollapsed?: boolean;
  rect?: Partial<DOMRect>;
}) {
  const {
    text,
    startNode,
    endNode = startNode,
    isCollapsed = false,
    rect = { top: 100, left: 20, width: 60 },
  } = overrides;
  return {
    isCollapsed,
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () => ({
      startContainer: startNode,
      endContainer: endNode,
      getBoundingClientRect: () => rect as DOMRect,
    }),
  } as unknown as Selection;
}

function fireSelectionChange(selection: Selection | null) {
  jest.spyOn(window, 'getSelection').mockReturnValue(selection);
  act(() => {
    document.dispatchEvent(new Event('selectionchange'));
  });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test('an in-bounds selection past the minimum surfaces the flattened text and position', () => {
  render(<Harness />);
  const container = screen.getByTestId('container');

  fireSelectionChange(
    fakeSelection({
      text: 'a passage worth discussing',
      startNode: container.firstChild as Node,
    }),
  );

  expect(screen.getByTestId('action-text')).toHaveTextContent(
    'a passage worth discussing',
  );
  expect(screen.getByTestId('action-top')).toHaveTextContent('100');
  expect(screen.getByTestId('action-left')).toHaveTextContent('50');
});

test('a collapsed selection shows no action', () => {
  render(<Harness />);
  const container = screen.getByTestId('container');

  fireSelectionChange(
    fakeSelection({
      text: '',
      startNode: container.firstChild as Node,
      isCollapsed: true,
    }),
  );

  expect(screen.getByTestId('action-text')).toHaveTextContent('none');
});

test('a below-minimum selection shows no action', () => {
  render(<Harness />);
  const container = screen.getByTestId('container');

  fireSelectionChange(
    fakeSelection({ text: 'hi', startNode: container.firstChild as Node }),
  );

  expect(screen.getByTestId('action-text')).toHaveTextContent('none');
});

test('a selection outside the container shows no action', () => {
  render(<Harness />);
  const outside = screen.getByTestId('outside');

  fireSelectionChange(
    fakeSelection({
      text: 'a passage worth discussing',
      startNode: outside.firstChild as Node,
    }),
  );

  expect(screen.getByTestId('action-text')).toHaveTextContent('none');
});

test('multi-paragraph whitespace is flattened to a single line', () => {
  render(<Harness />);
  const container = screen.getByTestId('container');

  fireSelectionChange(
    fakeSelection({
      text: 'first paragraph\n\n  second paragraph',
      startNode: container.firstChild as Node,
    }),
  );

  expect(screen.getByTestId('action-text')).toHaveTextContent(
    'first paragraph second paragraph',
  );
});

test('an over-length selection is truncated rather than rejected', () => {
  render(<Harness />);
  const container = screen.getByTestId('container');
  const longText = 'x'.repeat(HIGHLIGHTED_PASSAGE_MAX + 500);

  fireSelectionChange(
    fakeSelection({ text: longText, startNode: container.firstChild as Node }),
  );

  const rendered = screen.getByTestId('action-text').textContent ?? '';
  expect(rendered).toHaveLength(HIGHLIGHTED_PASSAGE_MAX);
});
