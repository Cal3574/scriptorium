import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import { agentEventFrame, type AgentEvent } from '@scriptorium/contracts';

import { ChatWidgetProvider } from './chat-widget-context';
import { AgentTab } from './agent-tab';

jest.mock('@clerk/react', () => ({
  useAuth: () => ({ getToken: async () => 'test-token' }),
}));

jest.mock('../env', () => ({
  env: {
    apiUrl: 'http://api.test',
    clerkPublishableKey: 'pk_test_x',
    isDev: true,
  },
}));

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <>{children}</>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

const usageRefetch = jest.fn();
jest.mock('../usage/use-usage', () => ({
  useUsage: () => ({ usage: null, refetch: usageRefetch }),
}));

const BOOK_A = '33333333-3333-4333-8333-333333333333';
const USER_MSG = '44444444-4444-4444-8444-444444444444';
const ASSISTANT_MSG = '55555555-5555-4555-8555-555555555555';
const THREAD_A = '66666666-6666-4666-8666-666666666666';
const NEW_USER_MSG = '77777777-7777-4777-8777-777777777777';
const NEW_ASSISTANT_MSG = '88888888-8888-4888-8888-888888888888';
const FAILED_USER_MSG = '99999999-9999-4999-8999-999999999999';

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
    push(event: AgentEvent) {
      queue.push(agentEventFrame(event));
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

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <ChatWidgetProvider>
            <Outlet />
          </ChatWidgetProvider>
        ),
        children: [
          { path: '/library', element: <AgentTab /> },
          {
            path: '/books/:bookId/read',
            element: <AgentTab />,
            handle: { isReaderRoute: true },
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const fetchMock = jest.fn();

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  usageRefetch.mockReset();
});

test('off a reader route with no last book, there is nothing to load and no request is made', () => {
  renderAt('/library');
  expect(
    screen.getByText(/open a book to start a conversation/i),
  ).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('an empty thread shows the highlight nudge, not a freeform composer', async () => {
  fetchMock.mockResolvedValue(
    jsonRes({ id: null, bookId: BOOK_A, createdAt: null, messages: [] }),
  );
  renderAt(`/books/${BOOK_A}/read`);

  expect(
    await screen.findByText(/highlight a passage while reading/i),
  ).toBeVisible();
  expect(screen.queryByLabelText('agent message')).not.toBeInTheDocument();
});

test('off a reader route, the Agent tab shows the thread for lastBookId', async () => {
  fetchMock.mockResolvedValueOnce(
    jsonRes({
      id: THREAD_A,
      bookId: BOOK_A,
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        {
          id: USER_MSG,
          role: 'user',
          message: 'About book A',
          highlightedPassage: 'Passage A',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    }),
  );
  const router = renderAt(`/books/${BOOK_A}/read`);
  expect(await screen.findByText('About book A')).toBeVisible();

  await act(async () => {
    await router.navigate('/library');
  });

  expect(screen.getByText('About book A')).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('an existing thread renders its history and a distinct quoted passage, and the composer works', async () => {
  fetchMock.mockResolvedValueOnce(
    jsonRes({
      id: THREAD_A,
      bookId: BOOK_A,
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        {
          id: USER_MSG,
          role: 'user',
          message: 'What do you make of this?',
          highlightedPassage: 'To be great is to be misunderstood.',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: ASSISTANT_MSG,
          role: 'assistant',
          message: 'Misunderstood by whom, do you think?',
          highlightedPassage: null,
          createdAt: '2026-01-01T00:01:00Z',
        },
      ],
    }),
  );
  renderAt(`/books/${BOOK_A}/read`);

  const quote = await screen.findByText('To be great is to be misunderstood.');
  expect(quote.tagName).toBe('BLOCKQUOTE');
  expect(screen.getByText('What do you make of this?')).toBeVisible();
  expect(
    screen.getByText('Misunderstood by whom, do you think?'),
  ).toBeVisible();

  const stream = deferredStream();
  fetchMock.mockResolvedValueOnce(stream.response);

  await userEvent.type(screen.getByLabelText('agent message'), 'A rebel.');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));

  expect(fetchMock).toHaveBeenLastCalledWith(
    `http://api.test/api/v1/books/${BOOK_A}/agent-messages`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ message: 'A rebel.' }),
    }),
  );

  stream.push({
    type: 'agent_turn_started',
    threadId: THREAD_A,
    userMessageId: NEW_USER_MSG,
  });
  expect(await screen.findByText('A rebel.')).toBeVisible();

  stream.push({ type: 'agent_text_delta', text: 'Say more.' });
  expect(await screen.findByText('Say more.')).toBeVisible();
  expect(screen.getByTestId('agent-reply-caret')).toBeInTheDocument();

  stream.push({
    type: 'agent_done',
    messageId: NEW_ASSISTANT_MSG,
    message: 'Say more.',
  });
  stream.finish();

  await waitFor(() =>
    expect(screen.queryByTestId('agent-reply-caret')).not.toBeInTheDocument(),
  );
  expect(usageRefetch).toHaveBeenCalled();
});

test('a mid-turn agent_error leaves the user message unanswered and shows an alert', async () => {
  fetchMock.mockResolvedValueOnce(
    jsonRes({
      id: THREAD_A,
      bookId: BOOK_A,
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        {
          id: USER_MSG,
          role: 'user',
          message: 'Seed',
          highlightedPassage: 'A seed passage.',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: ASSISTANT_MSG,
          role: 'assistant',
          message: 'A reply.',
          highlightedPassage: null,
          createdAt: '2026-01-01T00:01:00Z',
        },
      ],
    }),
  );
  renderAt(`/books/${BOOK_A}/read`);
  await screen.findByText('A seed passage.');

  const stream = deferredStream();
  fetchMock.mockResolvedValueOnce(stream.response);

  await userEvent.type(screen.getByLabelText('agent message'), 'boom?');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));

  stream.push({
    type: 'agent_turn_started',
    threadId: THREAD_A,
    userMessageId: FAILED_USER_MSG,
  });
  await screen.findByText('boom?');

  stream.push({ type: 'agent_error', message: 'generation failed' });
  stream.finish();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/didn't go through/i);
  expect(alert).toHaveTextContent('generation failed');
});

test('a 402 shows the limit-reached notice and refetches usage', async () => {
  fetchMock.mockResolvedValueOnce(
    jsonRes({
      id: THREAD_A,
      bookId: BOOK_A,
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        {
          id: USER_MSG,
          role: 'user',
          message: 'Seed',
          highlightedPassage: 'A seed passage.',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: ASSISTANT_MSG,
          role: 'assistant',
          message: 'A reply.',
          highlightedPassage: null,
          createdAt: '2026-01-01T00:01:00Z',
        },
      ],
    }),
  );
  renderAt(`/books/${BOOK_A}/read`);
  await screen.findByText('A seed passage.');

  fetchMock.mockResolvedValueOnce(
    jsonRes({ code: 'query_limit_reached' }, 402),
  );

  await userEvent.type(screen.getByLabelText('agent message'), 'one more?');
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));

  expect(await screen.findByText(/monthly question limit/i)).toBeVisible();
  expect(usageRefetch).toHaveBeenCalled();
});

test("switching from one book's reader to another's live-switches the shown thread", async () => {
  const BOOK_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  fetchMock.mockResolvedValueOnce(
    jsonRes({
      id: THREAD_A,
      bookId: BOOK_A,
      createdAt: '2026-01-01T00:00:00Z',
      messages: [
        {
          id: USER_MSG,
          role: 'user',
          message: 'About book A',
          highlightedPassage: 'Passage A',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    }),
  );

  const router = renderAt(`/books/${BOOK_A}/read`);

  expect(await screen.findByText('About book A')).toBeVisible();

  fetchMock.mockResolvedValueOnce(
    jsonRes({ id: null, bookId: BOOK_B, createdAt: null, messages: [] }),
  );
  await act(async () => {
    await router.navigate(`/books/${BOOK_B}/read`);
  });

  await waitFor(() =>
    expect(screen.queryByText('About book A')).not.toBeInTheDocument(),
  );
  expect(
    await screen.findByText(/highlight a passage while reading/i),
  ).toBeVisible();
});
