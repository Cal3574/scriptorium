import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThemeProvider } from '../theme';
import { routes } from '../routes';

// The reader is mounted through the real route tree (#136 + #138): shell,
// nested layout, TOC, ScrollRestoration, overview + chapter screens.

jest.mock('@clerk/react', () => ({
  ClerkProvider: (props: { children: unknown }) => props.children as never,
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    getToken: async () => 'test-token',
  }),
  SignIn: () => null,
  UserButton: () => <div data-testid="user-button" />,
  PricingTable: () => <div data-testid="pricing-table" />,
}));

jest.mock('../env', () => ({
  env: { clerkPublishableKey: 'pk_test_x', apiUrl: 'http://api.test' },
}));

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <>{children}</>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

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

jest.mock('../books/use-ingest-events', () => ({
  useIngestEvents: () => ({ progress: null, connected: false, deleted: false }),
}));

jest.mock('../books/pdf-preview', () => ({
  renderPdfPreview: jest.fn(async () => ({
    pageCount: 128,
    thumbnailUrl: 'data:image/png;base64,AAA',
  })),
}));

const mockApi = jest.fn();
jest.mock('../auth/use-api', () => ({ useApi: () => mockApi }));

jest.mock('../mf', () => ({
  hasProviderRemote: false,
  lazyProvider: () => () => null,
}));

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

const chapter = (i: number, over: Record<string, unknown> = {}) => ({
  id: `c${i + 1}`,
  chapterIndex: i,
  title: `Chapter ${i + 1} Title`,
  pageStart: i * 10 + 1,
  pageEnd: i * 10 + 10,
  summary: `Summary of chapter ${i + 1}.`,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const BOOK = {
  id: 'b1',
  title: 'Deep Work',
  author: 'Cal Newport',
  originalFilename: 'deep-work.pdf',
  fileSizeBytes: 1000,
  pageCount: 30,
  status: 'ready',
  failedStage: null,
  failureReason: null,
  summaryGeneratedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  summary: 'The whole-book summary in prose.',
  chapters: [chapter(0), chapter(1), chapter(2)],
};

const SOURCE = {
  chapterId: 'c1',
  chapterIndex: 0,
  title: 'Chapter 1 Title',
  pageStart: 1,
  pageEnd: 10,
  available: true,
  text: 'The reconstructed source prose of chapter one.',
  truncated: false,
};

type Handlers = Record<
  string,
  (init?: RequestInit) => Response | Promise<Response>
>;

function mockApiWith(handlers: Handlers) {
  mockApi.mockImplementation(async (path: string, init?: RequestInit) => {
    const h = handlers[path];
    if (h) return h(init);
    return jsonRes({ code: 'not_found' }, 404);
  });
}

function baseHandlers(overrides: Partial<Handlers> = {}): Handlers {
  return {
    '/api/v1/me': () => jsonRes({ id: 'u1', email: 'reader@test' }),
    '/api/v1/me/usage': () =>
      jsonRes({
        plan: 'free',
        books: { used: 1, limit: 2 },
        queries: { used: 1, limit: 20, resetsAt: '2099-01-01T00:00:00.000Z' },
      }),
    '/api/v1/books': () => jsonRes([]),
    '/api/v1/books/b1': () => jsonRes(BOOK),
    '/api/v1/books/b1/chapters/c1/source': () => jsonRes(SOURCE),
    ...overrides,
  };
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => mockApiWith(baseHandlers()));

afterEach(() => {
  cleanup();
  mockApi.mockReset();
  localStorage.clear();
  document.title = '';
});

test('the overview renders the whole-book summary and a "Start reading" link to chapter 1', async () => {
  renderAt('/books/b1/read');

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Deep Work' }),
  ).toBeVisible();
  expect(screen.getByText('The whole-book summary in prose.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Start reading' })).toHaveAttribute(
    'href',
    '/books/b1/read/1',
  );
});

test('a chapter shows its summary, the NN / NN counter, and prev disabled at chapter 1', async () => {
  renderAt('/books/b1/read/1');

  expect(
    await screen.findByRole('heading', { level: 1, name: 'Chapter 1 Title' }),
  ).toBeVisible();
  expect(screen.getByText('Summary of chapter 1.')).toBeVisible();
  expect(screen.getByText('01 / 03')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Previous chapter' }),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next chapter' })).toBeEnabled();
});

test('prev/next and the arrow keys walk chapters with no wrap', async () => {
  const router = renderAt('/books/b1/read/1');
  await screen.findByRole('heading', { name: 'Chapter 1 Title' });

  await userEvent.click(screen.getByRole('button', { name: 'Next chapter' }));
  expect(router.state.location.pathname).toBe('/books/b1/read/2');

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  expect(router.state.location.pathname).toBe('/books/b1/read/3');
  expect(
    await screen.findByRole('button', { name: 'Next chapter' }),
  ).toBeDisabled();

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  expect(router.state.location.pathname).toBe('/books/b1/read/3');
});

test('prev/next and the arrow keys carry the current view forward, so Source stays open across chapters', async () => {
  mockApiWith(
    baseHandlers({
      '/api/v1/books/b1/chapters/c2/source': () =>
        jsonRes({ ...SOURCE, chapterId: 'c2', chapterIndex: 1 }),
    }),
  );
  const router = renderAt('/books/b1/read/1?view=source');
  await screen.findByText('The reconstructed source prose of chapter one.');

  await userEvent.click(screen.getByRole('button', { name: 'Next chapter' }));
  expect(router.state.location.pathname).toBe('/books/b1/read/2');
  expect(router.state.location.search).toBe('?view=source');
  expect(screen.getByRole('button', { name: 'Source' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  });
  expect(router.state.location.pathname).toBe('/books/b1/read/1');
  expect(router.state.location.search).toBe('?view=source');
});

test('a leftward swipe on the chapter column moves to the next chapter', async () => {
  const router = renderAt('/books/b1/read/1');
  const article = await screen.findByRole('heading', {
    name: 'Chapter 1 Title',
  });
  const column = article.closest('article') as Element;

  await act(async () => {
    column.dispatchEvent(
      new TouchEvent('touchstart', {
        touches: [{ clientX: 200, clientY: 100 } as Touch],
      }),
    );
    column.dispatchEvent(
      new TouchEvent('touchend', {
        changedTouches: [{ clientX: 100, clientY: 100 } as Touch],
      }),
    );
  });

  expect(router.state.location.pathname).toBe('/books/b1/read/2');
});

test('the TOC marks the current chapter', async () => {
  renderAt('/books/b1/read/2');

  const current = await screen.findByRole('link', {
    name: /Chapter 2 Title/,
    current: 'page',
  });
  expect(current).toHaveAttribute('href', '/books/b1/read/2');
});

test('a bad :chapterNumber redirects to the overview', async () => {
  const router = renderAt('/books/b1/read/9');
  await screen.findByRole('heading', { level: 1, name: 'Deep Work' });
  expect(router.state.location.pathname).toBe('/books/b1/read');
});

test('a non-ready book redirects to Book-detail', async () => {
  mockApiWith(
    baseHandlers({
      '/api/v1/books/b1': () => jsonRes({ ...BOOK, status: 'summarizing' }),
    }),
  );
  const router = renderAt('/books/b1/read/1');
  await screen.findByRole('link', { name: /back to library/i });
  expect(router.state.location.pathname).toBe('/books/b1');
});

test('a 404 book redirects to the library', async () => {
  mockApiWith(
    baseHandlers({ '/api/v1/books/b1': () => jsonRes({ code: 'x' }, 404) }),
  );
  const router = renderAt('/books/b1/read/1');
  await screen.findByRole('heading', { name: 'Library' });
  expect(router.state.location.pathname).toBe('/library');
});

test('Source reveals the reconstructed text lazily; the browser back button returns to Summary', async () => {
  const router = renderAt('/books/b1/read/1');
  await screen.findByText('Summary of chapter 1.');
  expect(mockApi).not.toHaveBeenCalledWith(
    '/api/v1/books/b1/chapters/c1/source',
  );

  await userEvent.click(screen.getByRole('button', { name: 'Source' }));

  const sourceText = await screen.findByText(
    'The reconstructed source prose of chapter one.',
  );
  expect(sourceText).toBeVisible();
  expect(sourceText.closest('.prose')).toHaveClass('prose--reading');
  expect(
    screen.getByText(/Reconstructed from source · pp\. 1–10/),
  ).toBeVisible();
  expect(router.state.location.search).toBe('?view=source');
  expect(mockApi).toHaveBeenCalledWith('/api/v1/books/b1/chapters/c1/source');

  await act(async () => {
    await router.navigate(-1);
  });
  expect(await screen.findByText('Summary of chapter 1.')).toBeVisible();
  expect(router.state.location.search).toBe('');
});

test('the Summary control returns to the summary without leaving a stale ?view=source entry', async () => {
  const router = renderAt('/books/b1/read/1');
  await screen.findByText('Summary of chapter 1.');

  await userEvent.click(screen.getByRole('button', { name: 'Source' }));
  await screen.findByText(/Reconstructed from source/);

  await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
  expect(await screen.findByText('Summary of chapter 1.')).toBeVisible();
  expect(router.state.location.search).toBe('');

  // Summary replaced the source entry rather than stacking a third one, so
  // stepping back does not re-open the source.
  await act(async () => {
    await router.navigate(-1);
  });
  expect(router.state.location.search).toBe('');
  expect(
    screen.queryByText(/Reconstructed from source/),
  ).not.toBeInTheDocument();
});

test('toggling Summary <-> Source resets the column scroll to the top', async () => {
  const scrollTo = jest
    .spyOn(window, 'scrollTo')
    .mockImplementation(() => undefined);
  try {
    renderAt('/books/b1/read/1');
    await screen.findByText('Summary of chapter 1.');
    scrollTo.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Source' }));
    await screen.findByText('The reconstructed source prose of chapter one.');

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  } finally {
    scrollTo.mockRestore();
  }
});

test('the source fetch is cached: re-revealing a chapter does not refetch', async () => {
  renderAt('/books/b1/read/1');
  await screen.findByText('Summary of chapter 1.');

  await userEvent.click(screen.getByRole('button', { name: 'Source' }));
  await screen.findByText('The reconstructed source prose of chapter one.');
  await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
  await userEvent.click(screen.getByRole('button', { name: 'Source' }));
  await screen.findByText('The reconstructed source prose of chapter one.');

  const sourceCalls = mockApi.mock.calls.filter(
    ([path]) => path === '/api/v1/books/b1/chapters/c1/source',
  );
  expect(sourceCalls).toHaveLength(1);
});

test('available:false shows a quiet note and the summary stays one click away', async () => {
  mockApiWith(
    baseHandlers({
      '/api/v1/books/b1/chapters/c1/source': () =>
        jsonRes({ ...SOURCE, available: false, text: null }),
    }),
  );
  renderAt('/books/b1/read/1?view=source');

  expect(await screen.findByText(/don't hold readable text/i)).toBeVisible();

  await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
  expect(screen.getByText('Summary of chapter 1.')).toBeVisible();
});

test('truncated:true shows the trimmed-text note at the foot of the source', async () => {
  mockApiWith(
    baseHandlers({
      '/api/v1/books/b1/chapters/c1/source': () =>
        jsonRes({ ...SOURCE, truncated: true }),
    }),
  );
  renderAt('/books/b1/read/1?view=source');

  expect(
    await screen.findByText('The reconstructed source prose of chapter one.'),
  ).toBeVisible();
  expect(screen.getByText(/has been trimmed here/i)).toBeVisible();
});

test('a 404 on the source fetch shows a quiet inline error with a library link; the summary is untouched', async () => {
  mockApiWith(
    baseHandlers({
      '/api/v1/books/b1/chapters/c1/source': () =>
        jsonRes({ code: 'book_not_found' }, 404),
    }),
  );
  renderAt('/books/b1/read/1?view=source');

  expect(await screen.findByText(/no longer available/i)).toBeVisible();
  expect(
    screen.getByRole('link', { name: /back to the library/i }),
  ).toHaveAttribute('href', '/library');

  await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
  expect(screen.getByText('Summary of chapter 1.')).toBeVisible();
});
