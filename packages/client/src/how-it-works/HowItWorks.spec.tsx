import { render, screen, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { HowItWorks } from './HowItWorks';
import { HERO, RECAP, STOPS } from './stops';

// react-markdown / remark-gfm are pure ESM; the payoff stops render sample
// prose through SummaryProse, so pass the text straight through.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <>{children}</>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

// The structural content a reader gets should be present and visible without
// any scroll or animation. Simulate `prefers-reduced-motion: reduce` so the
// reveal never gates visibility - this is also the reduced-motion assertion.
beforeEach(() => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
});

afterEach(cleanup);

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/how-it-works', element: <HowItWorks /> },
      { path: '/library', element: <h1>Library</h1> },
    ],
    { initialEntries: ['/how-it-works'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

test('the hero states what the page covers and cues the scroll', () => {
  renderPage();
  expect(
    screen.getByRole('heading', { level: 1, name: HERO.title }),
  ).toBeVisible();
  expect(screen.getByText(HERO.promise)).toBeVisible();
  expect(screen.getByText(new RegExp(HERO.scrollCue, 'i'))).toBeVisible();
});

test('all eleven stop headings and their body copy render without scrolling', () => {
  renderPage();
  for (const stop of STOPS) {
    expect(
      screen.getByRole('heading', { level: 2, name: stop.heading }),
    ).toBeVisible();
    expect(screen.getByText(stop.body)).toBeVisible();
  }
});

test('both acts of the journey are covered', () => {
  renderPage();
  expect(STOPS.some((s) => s.act === 'reading')).toBe(true);
  expect(STOPS.some((s) => s.act === 'asking')).toBe(true);
  expect(screen.getByText('Reading a book')).toBeVisible();
  expect(screen.getByText('Asking a question')).toBeVisible();
});

test('the meaning-space step admits it is drawn flat but really many dimensions', () => {
  renderPage();
  expect(
    screen.getByText(/drawn flat here, but the real space has many more/i),
  ).toBeVisible();
});

test('the recap carries the short version, the trust line and a CTA into the product', () => {
  renderPage();
  expect(screen.getByText(RECAP.shortVersion)).toBeVisible();
  expect(screen.getByText(RECAP.trustLine)).toBeVisible();

  const cta = screen.getByRole('link', { name: RECAP.ctaLabel });
  expect(cta).toHaveAttribute('href', RECAP.ctaTo);
});

test('under reduced motion the panels are visible with no opacity gate', () => {
  renderPage();
  const panel = screen
    .getByRole('heading', { level: 2, name: STOPS[0].heading })
    .closest('section');
  expect(panel).toBeVisible();
  expect(panel).not.toHaveStyle({ opacity: '0' });
});
