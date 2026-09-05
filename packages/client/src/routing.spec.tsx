import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThemeProvider } from './theme';
import { routes } from './routes';

// Clerk: always loaded and signed in, so the shell (not <SignIn />) renders.
jest.mock('@clerk/react', () => ({
  ClerkProvider: (props: { children: unknown }) => props.children as never,
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    getToken: async () => 'test-token',
  }),
  SignIn: () => null,
  UserButton: () => <div data-testid="user-button" />,
}));

jest.mock('./env', () => ({
  env: { clerkPublishableKey: 'pk_test_x', apiUrl: 'http://api.test' },
}));

// react-markdown is pure ESM; render its text straight through in jsdom.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <>{children}</>,
}));

// The book row / detail live-progress stream: never connect an EventSource.
jest.mock('./books/use-ingest-events', () => ({
  useIngestEvents: () => ({ progress: null, connected: false, deleted: false }),
}));

const mockApi = jest.fn();
jest.mock('./auth/use-api', () => ({ useApi: () => mockApi }));

// The provider remote: keep it inert.
jest.mock('./mf', () => ({ lazyProvider: () => () => null }));

const BOOK = {
  id: 'b1',
  title: 'Deep Work',
  author: null,
  originalFilename: 'deep-work.pdf',
  status: 'ready',
  summary: null,
  chapters: [],
  failedStage: null,
  failureReason: null,
};

const QUERY = {
  id: 'q1',
  question: 'What is focus?',
  answer: 'Focus is a skill.',
  citations: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  failed: false,
};

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === '/api/v1/me')
      return jsonRes({ id: 'u1', email: 'reader@test' });
    if (path === '/api/v1/books') return jsonRes([BOOK]);
    if (path === '/api/v1/books/b1') return jsonRes(BOOK);
    if (path === '/api/v1/queries') return jsonRes([QUERY]);
    if (path === '/api/v1/queries/q1') return jsonRes(QUERY);
    return jsonRes({ code: 'not_found' }, 404);
  });
});

afterEach(() => {
  cleanup();
  mockApi.mockReset();
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

test('/ redirects to the library', async () => {
  const router = renderAt('/');
  expect(await screen.findByRole('heading', { name: 'Library' })).toBeVisible();
  expect(router.state.location.pathname).toBe('/library');
});

test('/books/:bookId renders BookDetail; the back link returns to /library', async () => {
  const router = renderAt('/books/b1');
  expect(
    await screen.findByRole('heading', { name: 'Deep Work' }),
  ).toBeVisible();

  await userEvent.click(screen.getByRole('link', { name: /back to library/i }));

  expect(await screen.findByRole('heading', { name: 'Library' })).toBeVisible();
  expect(router.state.location.pathname).toBe('/library');
});

test('browser back from a book returns to the library', async () => {
  const router = renderAt('/library');
  await userEvent.click(await screen.findByRole('link', { name: 'Deep Work' }));
  expect(
    await screen.findByRole('heading', { name: 'Deep Work' }),
  ).toBeVisible();

  await act(async () => {
    await router.navigate(-1);
  });

  expect(await screen.findByRole('heading', { name: 'Library' })).toBeVisible();
  expect(router.state.location.pathname).toBe('/library');
});

test('/ask/:queryId renders that past query', async () => {
  renderAt('/ask/q1');
  expect(
    await screen.findByRole('heading', { name: 'What is focus?' }),
  ).toBeVisible();
  expect(screen.getByText('Focus is a skill.')).toBeVisible();
});

test('the active nav link reflects the route', async () => {
  renderAt('/history');
  await screen.findByRole('heading', { name: 'Your questions' });

  expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.getByRole('link', { name: 'Library' })).not.toHaveAttribute(
    'aria-current',
  );
});
