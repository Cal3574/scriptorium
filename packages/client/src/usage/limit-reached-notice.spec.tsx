import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { UsageDto } from '@scriptorium/contracts';

import { LimitReachedNotice } from './limit-reached-notice';

let currentUsage: UsageDto | null = null;
jest.mock('./use-usage', () => ({
  useUsage: () => ({ usage: currentUsage, refetch: jest.fn() }),
}));

const RESETS_AT = new Date(Date.now() + 4 * 86_400_000).toISOString();

afterEach(() => {
  cleanup();
  currentUsage = null;
});

function renderNotice(code: 'book_limit_reached' | 'query_limit_reached') {
  return render(
    <MemoryRouter>
      <LimitReachedNotice code={code} />
    </MemoryRouter>,
  );
}

test('book limit: title, live numbers from useUsage, and an Upgrade button to /pricing', () => {
  currentUsage = {
    plan: 'free',
    books: { used: 2, limit: 2 },
    queries: { used: 3, limit: 20, resetsAt: RESETS_AT },
  };
  renderNotice('book_limit_reached');

  expect(screen.getByText(/reached your book limit/i)).toBeVisible();
  expect(screen.getByText(/used 2 of 2 books/i)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute(
    'href',
    '/pricing',
  );
});

test('question limit: uses the queries allowance numbers', () => {
  currentUsage = {
    plan: 'free',
    books: { used: 0, limit: 2 },
    queries: { used: 20, limit: 20, resetsAt: RESETS_AT },
  };
  renderNotice('query_limit_reached');

  expect(screen.getByText(/monthly question limit/i)).toBeVisible();
  expect(screen.getByText(/used 20 of 20 questions/i)).toBeVisible();
});

test('a Pro reader at the ceiling gets no upgrade CTA, just a link to the plans', () => {
  currentUsage = {
    plan: 'pro',
    books: { used: 50, limit: 50 },
    queries: { used: 3, limit: 1000, resetsAt: RESETS_AT },
  };
  renderNotice('book_limit_reached');

  expect(screen.getByText(/Pro plan ceiling/i)).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Upgrade to Pro' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View plans' })).toHaveAttribute(
    'href',
    '/pricing',
  );
});

test('renders without live numbers when usage has not loaded yet', () => {
  currentUsage = null;
  renderNotice('book_limit_reached');

  expect(screen.getByText(/books allowance is used up/i)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Upgrade to Pro' })).toBeVisible();
});
