import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import { queryEventFrame, type QueryEvent } from '@scriptorium/contracts';

import { ChatWidgetProvider, useChatWidget } from './chat-widget-context';
import { AskLibraryTab } from './ask-library-tab';

jest.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: async () => 'test-token' }),
}));

jest.mock('../env', () => ({
  env: { apiUrl: 'http://api.test', clerkPublishableKey: 'pk_test_x' },
}));

// react-markdown / remark-gfm are pure ESM; render the text straight through.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <>{children}</>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

const usageRefetch = jest.fn();
let currentUsage: {
  plan: 'free' | 'pro';
  queries: { used: number; limit: number };
} | null = null;
jest.mock('../usage/use-usage', () => ({
  useUsage: () => ({ usage: currentUsage, refetch: usageRefetch }),
  queryQuotaExhausted: (usage: { queries: { used: number; limit: number } } | null) =>
    usage != null && usage.queries.used >= usage.queries.limit,
}));

const CHUNK_A = '11111111-1111-4111-8111-111111111111';
const CHUNK_B = '22222222-2222-4222-8222-222222222222';
const BOOK_A = '33333333-3333-4333-8333-333333333333';

// A ReadableStream-shaped response whose frames are pushed by the test, so a
// mid-stream assertion (the caret) can run before `done` lands.
function deferredStream() {
  const queue: string[] = [];
  let finished = false;
  let waiting: ((r: { done: boolean; value?: Uint8Array }) => void) | null =
    null;

  const settle = () => {
    if (!waiting) return;
    if (queue.length > 0) {
      waiting({ done: false, value: new TextEncoder().encode(queue.shift()) });
      waiting = null;
    } else if (finished) {
      waiting({ done: true });
      waiting = null;
    }
  };

  const response = {
    ok: true,
    body: {
      getReader: () => ({
        read: () =>
          new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
            waiting = resolve;
            settle();
          }),
      }),
    },
  } as unknown as Response;

  return {
    response,
    push(event: QueryEvent) {
      queue.push(queryEventFrame(event));
      settle();
    },
    finish() {
      finished = true;
      settle();
    },
  };
}

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

// Shows whether the widget panel is open, so a test can assert the upgrade
// CTA closed it - real open/close state from the provider, not a stand-in.
function OpenStateProbe() {
  const { isOpen, open } = useChatWidget();
  return (
    <div>
      <span data-testid="widget-open-state">{isOpen ? 'open' : 'closed'}</span>
      <button onClick={open}>open widget</button>
    </div>
  );
}

// A layout route so `OpenStateProbe` (standing in for the always-mounted
// `ChatWidget` panel) survives the `/pricing` navigation the upgrade CTA
// triggers, the same way the real widget persists across routes (#159).
function Layout() {
  return (
    <ChatWidgetProvider>
      <OpenStateProbe />
      <Outlet />
    </ChatWidgetProvider>
  );
}

function renderTab() {
  const router = createMemoryRouter(
    [
      {
        element: <Layout />,
        children: [
          { path: '/library', element: <AskLibraryTab /> },
          { path: '/pricing', element: <p>pricing page</p> },
        ],
      },
    ],
    { initialEntries: ['/library'] },
  );
  render(<RouterProvider router={router} />);
}

const fetchMock = jest.fn();

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  usageRefetch.mockReset();
  currentUsage = null;
});

test('shows the helper copy and a disabled Ask button before anything is typed', () => {
  renderTab();
  expect(
    screen.getByText(/grounded in citations from every book/i),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
});

test('the Ask button is enabled once the question box has content', async () => {
  renderTab();
  await userEvent.type(screen.getByLabelText('question'), 'What is focus?');
  expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled();
});

test('asking POSTs the question and streams the answer into prose with citations and passages', async () => {
  const stream = deferredStream();
  fetchMock.mockResolvedValue(stream.response);
  renderTab();

  await userEvent.type(screen.getByLabelText('question'), 'What is deep work?');
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

  expect(fetchMock).toHaveBeenCalledWith(
    'http://api.test/api/v1/queries',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ question: 'What is deep work?' }),
    }),
  );

  expect(
    await screen.findByRole('button', { name: /thinking/i }),
  ).toBeDisabled();

  stream.push({
    type: 'citations',
    citations: [
      {
        marker: 1,
        chunkId: CHUNK_A,
        bookId: BOOK_A,
        bookTitle: 'Deep Work',
        chapterTitle: 'Rules of Focus',
        chunkText: 'Focus is a skill you train.',
      },
      {
        marker: 2,
        chunkId: CHUNK_B,
        bookId: BOOK_A,
        bookTitle: 'Deep Work',
        chapterTitle: 'Shallow Work',
        chunkText: 'Shallow work is easy to replace.',
      },
    ],
  });
  stream.push({ type: 'text_delta', text: 'Deep work is ' });
  stream.push({ type: 'text_delta', text: 'focused effort.' });

  expect(await screen.findByText('Deep work is focused effort.')).toBeVisible();
  expect(screen.getByTestId('answer-caret')).toBeInTheDocument();

  const citations = screen.getByRole('list');
  expect(citations).toHaveTextContent('[1]');
  expect(citations).toHaveTextContent('Deep Work - Rules of Focus');

  const passagesTrigger = screen.getByRole('button', {
    name: /retrieved passages/i,
  });
  await userEvent.click(passagesTrigger);
  const quote = await screen.findByText('Focus is a skill you train.');
  expect(quote.tagName).toBe('BLOCKQUOTE');

  stream.push({ type: 'done', answer: 'Deep work is focused effort.' });
  stream.finish();

  await waitFor(() =>
    expect(screen.queryByTestId('answer-caret')).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled();
  expect(usageRefetch).toHaveBeenCalled();
});

test('a query error surfaces in an alert', async () => {
  const stream = deferredStream();
  fetchMock.mockResolvedValue(stream.response);
  renderTab();

  await userEvent.type(screen.getByLabelText('question'), 'boom?');
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

  stream.push({ type: 'error', message: 'retrieval failed' });
  stream.finish();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/didn't go through/i);
  expect(alert).toHaveTextContent('retrieval failed');
});

test('a 402 shows the limit-reached notice and refetches usage, not a plain error', async () => {
  fetchMock.mockResolvedValue(jsonRes({ code: 'query_limit_reached' }, 402));
  renderTab();

  await userEvent.type(screen.getByLabelText('question'), 'one more?');
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

  expect(await screen.findByText(/monthly question limit/i)).toBeVisible();
  expect(usageRefetch).toHaveBeenCalled();
  expect(screen.queryByText(/didn't go through/i)).not.toBeInTheDocument();
});

test('opening with the quota already exhausted shows the banner immediately, with no round-trip and a disabled composer', () => {
  currentUsage = { plan: 'free', queries: { used: 20, limit: 20 } };
  renderTab();

  expect(screen.getByText(/monthly question limit/i)).toBeVisible();
  expect(
    screen.queryByText(/grounded in citations from every book/i),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('question')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('clicking the upgrade CTA navigates to /pricing and closes the widget', async () => {
  currentUsage = { plan: 'free', queries: { used: 20, limit: 20 } };
  renderTab();
  await userEvent.click(screen.getByRole('button', { name: 'open widget' }));
  expect(screen.getByTestId('widget-open-state')).toHaveTextContent('open');

  await userEvent.click(
    screen.getByRole('link', { name: 'Upgrade to Pro' }),
  );

  expect(await screen.findByText('pricing page')).toBeVisible();
  expect(screen.getByTestId('widget-open-state')).toHaveTextContent('closed');
});
