import { render, screen, cleanup } from '@testing-library/react';

import { FallbackVisual } from './FallbackVisual';
import { PinnedStage } from './PinnedStage';
import { MEANING_SPACE_CAVEAT, STOPS } from './stops';

// react-markdown / remark-gfm are ESM; the payoff card renders sample prose.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <>{children}</>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

afterEach(cleanup);

test('with no WebGL (jsdom) the stage renders the flat fallback, never a canvas', () => {
  const { container } = render(<PinnedStage step={0} />);
  expect(container.querySelector('canvas')).toBeNull();
  expect(container.querySelector('svg')).toBeInTheDocument();
});

test('the fallback carries the meaning-space caveat on the scatter steps', () => {
  const scatter = STOPS.findIndex((s) => s.id === 'meaning-space');
  render(<FallbackVisual step={scatter} />);
  expect(screen.getByText(MEANING_SPACE_CAVEAT)).toBeInTheDocument();
});

test('the payoff steps render the real product component with sample content', () => {
  const summary = STOPS.findIndex((s) => s.id === 'book-summary');
  render(<PinnedStage step={summary} />);
  expect(screen.getByText('Sample summary')).toBeInTheDocument();
});
