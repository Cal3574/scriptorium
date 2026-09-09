import { render, screen, cleanup, act, waitFor } from '@testing-library/react';

import { UsageProvider, useUsage } from './use-usage';
import { notifyPaymentRequired } from './payment-required-bus';

const api = jest.fn();
jest.mock('../auth/use-api', () => ({ useApi: () => api }));

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

const USAGE = {
  plan: 'free' as const,
  books: { used: 1, limit: 2 },
  queries: { used: 3, limit: 20, resetsAt: '2099-01-01T00:00:00.000Z' },
};

// A probe that renders the current used counts and exposes `refetch`.
let refetch: () => Promise<void>;
function Probe() {
  const { usage, refetch: r } = useUsage();
  refetch = r;
  return (
    <span data-testid="q-used">{usage ? usage.queries.used : 'none'}</span>
  );
}

function renderProvider() {
  return render(
    <UsageProvider>
      <Probe />
    </UsageProvider>,
  );
}

afterEach(() => {
  cleanup();
  api.mockReset();
});

test('usage is null until refetch, then holds the parsed DTO', async () => {
  api.mockResolvedValue(jsonRes(USAGE));
  renderProvider();

  expect(screen.getByTestId('q-used')).toHaveTextContent('none');

  await act(async () => {
    await refetch();
  });
  expect(screen.getByTestId('q-used')).toHaveTextContent('3');
  expect(api).toHaveBeenCalledWith('/api/v1/me/usage');
});

test('a payment-required signal refetches the meter', async () => {
  api.mockResolvedValue(jsonRes(USAGE));
  renderProvider();
  await act(async () => {
    await refetch();
  });
  api.mockResolvedValue(
    jsonRes({ ...USAGE, queries: { ...USAGE.queries, used: 20 } }),
  );

  await act(async () => {
    notifyPaymentRequired();
  });

  await waitFor(() =>
    expect(screen.getByTestId('q-used')).toHaveTextContent('20'),
  );
});

test('a failed fetch keeps the last good value', async () => {
  api.mockResolvedValue(jsonRes(USAGE));
  renderProvider();
  await act(async () => {
    await refetch();
  });

  api.mockRejectedValue(new Error('network'));
  await act(async () => {
    await refetch();
  });
  expect(screen.getByTestId('q-used')).toHaveTextContent('3');
});

test('the subscription is torn down on unmount', async () => {
  api.mockResolvedValue(jsonRes(USAGE));
  const { unmount } = renderProvider();
  await act(async () => {
    await refetch();
  });
  unmount();

  // No provider mounted: the bus fan-out must not throw or touch the API.
  api.mockClear();
  act(() => notifyPaymentRequired());
  expect(api).not.toHaveBeenCalled();
});

test('useUsage throws outside the provider', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => render(<Probe />)).toThrow(/UsageProvider/);
  spy.mockRestore();
});
