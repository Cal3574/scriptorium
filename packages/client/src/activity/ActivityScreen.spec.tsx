import { render, screen, cleanup } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { ActivityScreen } from './ActivityScreen';

jest.mock('../env', () => ({
  env: { apiUrl: 'http://api.test', clerkPublishableKey: 'pk_test_x' },
}));

// recharts needs a real ESM d3 stack and layout dimensions - stub the
// primitives the charts use so the screen renders in jsdom.
jest.mock('recharts', () => {
  const Pass = ({ children }: { children?: unknown }) => (
    <div>{children as never}</div>
  );
  const Nothing = () => null;
  return {
    ResponsiveContainer: Pass,
    BarChart: Pass,
    Bar: Nothing,
    CartesianGrid: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    Tooltip: Nothing,
    Legend: Nothing,
  };
});

const mockApi = jest.fn();
jest.mock('../auth/use-api', () => ({ useApi: () => mockApi }));

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

const BOOK_ID = '33333333-3333-4333-8333-333333333333';

function activity(overrides: Record<string, unknown> = {}) {
  return {
    totals: { books: 5, questions: 120, pagesIngested: 2400 },
    plan: {
      plan: 'free',
      questionsUsed: 14,
      questionsLimit: 20,
      resetsAt: '2099-01-01T00:00:00.000Z',
    },
    monthly: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      books: i === 11 ? 2 : 0,
      questions: i === 11 ? 30 : 0,
    })),
    topBooks: [{ bookId: BOOK_ID, title: 'Deep Work', questionCount: 9 }],
    ...overrides,
  };
}

function renderScreen() {
  const router = createMemoryRouter(
    [
      { path: '/activity', element: <ActivityScreen /> },
      { path: '/books/:id', element: <h1>Book</h1> },
      { path: '/ask', element: <h1>Ask</h1> },
      { path: '/pricing', element: <h1>Plans</h1> },
    ],
    { initialEntries: ['/activity'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  cleanup();
  mockApi.mockReset();
});

test('renders the four headline tiles from the payload', async () => {
  mockApi.mockResolvedValue(jsonRes(activity()));
  renderScreen();

  expect(await screen.findByText('Books uploaded')).toBeVisible();
  expect(
    screen.getByRole('heading', { name: 'Activity' }),
  ).toBeVisible();
  expect(screen.getByText('5')).toBeVisible();
  expect(screen.getByText('120')).toBeVisible();
  expect(screen.getByText('2,400')).toBeVisible();
  // Free plan tile: the questions subline and the pricing link.
  expect(screen.getByText(/14 \/ 20 questions/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'View plans' })).toHaveAttribute(
    'href',
    '/pricing',
  );
});

test('a Pro reader gets the plan badge and no pricing link', async () => {
  mockApi.mockResolvedValue(
    jsonRes(
      activity({
        plan: {
          plan: 'pro',
          questionsUsed: 4,
          questionsLimit: 1000,
          resetsAt: '2099-01-01T00:00:00.000Z',
        },
      }),
    ),
  );
  renderScreen();

  expect(await screen.findByText('Pro')).toBeVisible();
  expect(screen.getByText(/4 \/ 1000 questions/)).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'View plans' }),
  ).not.toBeInTheDocument();
});

test('the most-asked-books list links each row to its book', async () => {
  mockApi.mockResolvedValue(jsonRes(activity()));
  renderScreen();

  const row = await screen.findByRole('link', { name: /Deep Work/ });
  expect(row).toHaveAttribute('href', `/books/${BOOK_ID}`);
  expect(screen.getByText('9 questions')).toBeVisible();
});

test('an all-zero series shows the tracking hint instead of a chart', async () => {
  mockApi.mockResolvedValue(
    jsonRes(
      activity({
        totals: { books: 0, questions: 0, pagesIngested: 0 },
        monthly: Array.from({ length: 12 }, (_, i) => ({
          month: `2026-${String(i + 1).padStart(2, '0')}`,
          books: 0,
          questions: 0,
        })),
        topBooks: [],
      }),
    ),
  );
  renderScreen();

  expect(
    await screen.findByText('No books in the last 12 months'),
  ).toBeVisible();
  expect(
    screen.getByText('No questions in the last 12 months'),
  ).toBeVisible();
  expect(
    screen.getByText(/Ask a question about a book/),
  ).toBeVisible();
});

test('a failed load surfaces an alert', async () => {
  mockApi.mockResolvedValue(jsonRes({ code: 'boom' }, 500));
  renderScreen();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/couldn't load your activity/i);
});
