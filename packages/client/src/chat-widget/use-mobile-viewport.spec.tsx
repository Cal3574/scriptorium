import { render, screen, cleanup, act } from '@testing-library/react';

import { useIsMobileViewport } from './use-mobile-viewport';

let listeners: Array<(e: { matches: boolean }) => void> = [];
let currentMatches = false;

function Probe() {
  const isMobile = useIsMobileViewport();
  return <span data-testid="result">{isMobile ? 'mobile' : 'desktop'}</span>;
}

beforeEach(() => {
  listeners = [];
  currentMatches = false;
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    get matches() {
      return currentMatches;
    },
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => {
      listeners.push(cb);
    },
    removeEventListener: (
      _type: string,
      cb: (e: { matches: boolean }) => void,
    ) => {
      listeners = listeners.filter((l) => l !== cb);
    },
    dispatchEvent: () => false,
  }));
});

afterEach(cleanup);

test('reports desktop when the query does not match', () => {
  currentMatches = false;
  render(<Probe />);
  expect(screen.getByTestId('result')).toHaveTextContent('desktop');
});

test('reports mobile when the query matches', () => {
  currentMatches = true;
  render(<Probe />);
  expect(screen.getByTestId('result')).toHaveTextContent('mobile');
});

test('reacts live to a viewport crossing the breakpoint', () => {
  currentMatches = false;
  render(<Probe />);
  expect(screen.getByTestId('result')).toHaveTextContent('desktop');

  currentMatches = true;
  act(() => {
    listeners.forEach((l) => l({ matches: true }));
  });

  expect(screen.getByTestId('result')).toHaveTextContent('mobile');
});
