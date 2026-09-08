import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { UsageDto } from '@scriptorium/contracts';

import { UsageMeter } from './usage-meter';

afterEach(cleanup);

const RESETS_AT = new Date(Date.now() + 4 * 86_400_000).toISOString();

function usage(overrides: Partial<UsageDto> = {}): UsageDto {
  return {
    plan: 'free',
    books: { used: 1, limit: 2 },
    queries: { used: 5, limit: 20, resetsAt: RESETS_AT },
    ...overrides,
  };
}

function renderMeter(u: UsageDto) {
  return render(
    <MemoryRouter>
      <UsageMeter usage={u} />
    </MemoryRouter>,
  );
}

test('renders both tracks with counts and the reset distance', () => {
  renderMeter(usage());
  expect(screen.getByText('Books 1 / 2')).toBeVisible();
  expect(screen.getByText('Questions 5 / 20 · resets in 4d')).toBeVisible();
  expect(
    screen.getByRole('progressbar', { name: 'Books 1 of 2' }),
  ).toHaveAttribute('aria-valuenow', '1');
});

test('the whole meter links to /pricing', () => {
  renderMeter(usage());
  expect(
    screen.getByRole('link', { name: 'View plans and pricing' }),
  ).toHaveAttribute('href', '/pricing');
});

test('normal state below 80%: muted text, no upgrade affordance', () => {
  renderMeter(usage({ queries: { used: 15, limit: 20, resetsAt: RESETS_AT } }));
  expect(screen.getByText('Questions 15 / 20 · resets in 4d')).toHaveClass(
    'text-muted-foreground',
  );
  expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument();
});

test('amber state from 80%: amber text and the upgrade affordance', () => {
  renderMeter(usage({ queries: { used: 16, limit: 20, resetsAt: RESETS_AT } }));
  expect(screen.getByText('Questions 16 / 20 · resets in 4d')).toHaveClass(
    'text-status-progress',
  );
  expect(screen.getByText('Upgrade to Pro')).toBeVisible();
});

test('red state at 100%: red text and the upgrade affordance', () => {
  renderMeter(usage({ books: { used: 2, limit: 2 } }));
  expect(screen.getByText('Books 2 / 2')).toHaveClass('text-status-failed');
  expect(screen.getByText('Upgrade to Pro')).toBeVisible();
});

test('red state past 100% (former Pro over the Free ceiling)', () => {
  renderMeter(usage({ books: { used: 7, limit: 2 } }));
  expect(screen.getByText('Books 7 / 2')).toHaveClass('text-status-failed');
});

test('the upgrade affordance never shows on the Pro plan', () => {
  renderMeter(
    usage({
      plan: 'pro',
      queries: { used: 1000, limit: 1000, resetsAt: RESETS_AT },
    }),
  );
  expect(screen.getByText('Questions 1000 / 1000 · resets in 4d')).toHaveClass(
    'text-status-failed',
  );
  expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument();
});
