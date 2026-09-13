import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';

import { ChatWidgetProvider, useChatWidget } from './chat-widget-context';

// A probe that renders every piece of shell state and exposes the setters
// as buttons/callbacks a test can drive.
function Probe() {
  const {
    isOpen,
    open,
    close,
    toggle,
    activeTab,
    setActiveTab,
    askDraft,
    setAskDraft,
    lastBookId,
  } = useChatWidget();
  return (
    <div>
      <span data-testid="is-open">{String(isOpen)}</span>
      <span data-testid="active-tab">{activeTab}</span>
      <span data-testid="draft">{askDraft}</span>
      <span data-testid="last-book-id">{lastBookId ?? 'none'}</span>
      <button onClick={open}>open</button>
      <button onClick={close}>close</button>
      <button onClick={toggle}>toggle</button>
      <button onClick={() => setActiveTab('agent')}>switch to agent</button>
      <button onClick={() => setAskDraft('what is focus?')}>set draft</button>
    </div>
  );
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
          { path: '/library', element: <Probe /> },
          {
            path: '/books/:bookId/read',
            element: <Probe />,
            handle: { isReaderRoute: true },
          },
          {
            path: '/books/:bookId/read/:chapterNumber',
            element: <Probe />,
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

afterEach(cleanup);

test('defaults to closed, the ask-library tab, an empty draft, and no last book', () => {
  renderAt('/library');
  expect(screen.getByTestId('is-open')).toHaveTextContent('false');
  expect(screen.getByTestId('active-tab')).toHaveTextContent('ask-library');
  expect(screen.getByTestId('draft')).toHaveTextContent('');
  expect(screen.getByTestId('last-book-id')).toHaveTextContent('none');
});

test('open/close/toggle drive isOpen', async () => {
  renderAt('/library');
  const user = userEvent.setup();

  await user.click(screen.getByText('open'));
  expect(screen.getByTestId('is-open')).toHaveTextContent('true');

  await user.click(screen.getByText('close'));
  expect(screen.getByTestId('is-open')).toHaveTextContent('false');

  await user.click(screen.getByText('toggle'));
  expect(screen.getByTestId('is-open')).toHaveTextContent('true');
});

test('setActiveTab switches the active tab only on the explicit call', async () => {
  renderAt('/library');
  const user = userEvent.setup();

  await user.click(screen.getByText('switch to agent'));
  expect(screen.getByTestId('active-tab')).toHaveTextContent('agent');
});

test('setAskDraft updates the shared draft', async () => {
  renderAt('/library');
  const user = userEvent.setup();

  await user.click(screen.getByText('set draft'));
  expect(screen.getByTestId('draft')).toHaveTextContent('what is focus?');
});

test('landing on a reader route sets lastBookId', () => {
  renderAt('/books/book-1/read');
  expect(screen.getByTestId('last-book-id')).toHaveTextContent('book-1');
});

test('a reader chapter route also sets lastBookId', () => {
  renderAt('/books/book-2/read/3');
  expect(screen.getByTestId('last-book-id')).toHaveTextContent('book-2');
});

test('navigating away from a reader route keeps the last book remembered', async () => {
  const router = createMemoryRouter(
    [
      {
        element: (
          <ChatWidgetProvider>
            <Outlet />
          </ChatWidgetProvider>
        ),
        children: [
          { path: '/library', element: <Probe /> },
          {
            path: '/books/:bookId/read',
            element: <Probe />,
            handle: { isReaderRoute: true },
          },
        ],
      },
    ],
    { initialEntries: ['/books/book-3/read'] },
  );
  render(<RouterProvider router={router} />);
  expect(screen.getByTestId('last-book-id')).toHaveTextContent('book-3');

  await act(async () => {
    await router.navigate('/library');
  });
  expect(screen.getByTestId('last-book-id')).toHaveTextContent('book-3');
});

test('useChatWidget throws outside the provider', () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  function Bare() {
    useChatWidget();
    return null;
  }
  expect(() => render(<Bare />)).toThrow(/ChatWidgetProvider/);
  spy.mockRestore();
});
