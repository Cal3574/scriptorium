import { render, screen, cleanup, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';

import { ChatWidgetProvider } from './chat-widget-context';
import { useAgentBookId } from './use-agent-book-id';

function Probe() {
  const bookId = useAgentBookId();
  return <span data-testid="agent-book-id">{bookId ?? 'none'}</span>;
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

test('off any reader route with nothing read yet, there is no current book', () => {
  renderAt('/library');
  expect(screen.getByTestId('agent-book-id')).toHaveTextContent('none');
});

test('on a book reader route, that book is current', () => {
  renderAt('/books/book-1/read');
  expect(screen.getByTestId('agent-book-id')).toHaveTextContent('book-1');
});

test('on a reader chapter route, that book is current', () => {
  renderAt('/books/book-2/read/3');
  expect(screen.getByTestId('agent-book-id')).toHaveTextContent('book-2');
});

test('navigating off a reader route falls back to lastBookId', async () => {
  const router = renderAt('/books/book-3/read');
  expect(screen.getByTestId('agent-book-id')).toHaveTextContent('book-3');

  await act(async () => {
    await router.navigate('/library');
  });
  expect(screen.getByTestId('agent-book-id')).toHaveTextContent('book-3');
});

test('navigating live between two books\' readers follows the current one', async () => {
  const router = renderAt('/books/book-4/read');
  expect(screen.getByTestId('agent-book-id')).toHaveTextContent('book-4');

  await act(async () => {
    await router.navigate('/books/book-5/read');
  });
  expect(screen.getByTestId('agent-book-id')).toHaveTextContent('book-5');
});
