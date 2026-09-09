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
  PricingTable: (props: Record<string, unknown>) => (
    <div
      data-testid="pricing-table"
      data-redirect={String(props.newSubscriptionRedirectUrl)}
      data-highlighted={String(props.highlightedPlan)}
    />
  ),
}));

jest.mock('./env', () => ({
  env: { clerkPublishableKey: 'pk_test_x', apiUrl: 'http://api.test' },
}));

// react-markdown and remark-gfm are pure ESM; render the text straight
// through in jsdom and drop the plugin.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <>{children}</>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

// recharts pulls a heavy ESM d3 stack and needs real layout dimensions;
// neither survives jsdom. Stub the primitives the Activity charts use.
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

// The book row / detail live-progress stream: never connect an EventSource.
jest.mock('./books/use-ingest-events', () => ({
  useIngestEvents: () => ({ progress: null, connected: false, deleted: false }),
}));

const mockApi = jest.fn();
jest.mock('./auth/use-api', () => ({ useApi: () => mockApi }));

// The provider remote: keep it inert.
jest.mock('./mf', () => ({
  hasProviderRemote: false,
  lazyProvider: () => () => null,
}));

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

const USAGE = {
  plan: 'free',
  books: { used: 1, limit: 2 },
  queries: {
    used: 14,
    limit: 20,
    resetsAt: '2099-01-01T00:00:00.000Z',
  },
};

const ACTIVITY = {
  totals: { books: 3, questions: 42, pagesIngested: 1200 },
  plan: {
    plan: 'free',
    questionsUsed: 14,
    questionsLimit: 20,
    resetsAt: '2099-01-01T00:00:00.000Z',
  },
  monthly: Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    books: i === 11 ? 2 : 0,
    questions: i === 11 ? 9 : 0,
  })),
  topBooks: [
    {
      bookId: '44444444-4444-4444-8444-444444444444',
      title: 'Deep Work',
      questionCount: 9,
    },
  ],
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
    if (path === '/api/v1/me/usage') return jsonRes(USAGE);
    if (path === '/api/v1/me/activity') return jsonRes(ACTIVITY);
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
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';
  document.title = '';
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

test('document.title follows the route', async () => {
  renderAt('/library');
  expect(await screen.findByRole('heading', { name: 'Library' })).toBeVisible();
  expect(document.title).toBe('Library · Scriptorium');
});

test('a book page titles itself after the book; leaving it resets the title', async () => {
  const router = renderAt('/books/b1');
  expect(
    await screen.findByRole('heading', { name: 'Deep Work' }),
  ).toBeVisible();
  expect(document.title).toBe('Deep Work · Scriptorium');

  await userEvent.click(screen.getByRole('link', { name: /back to library/i }));
  expect(await screen.findByRole('heading', { name: 'Library' })).toBeVisible();
  expect(router.state.location.pathname).toBe('/library');
  expect(document.title).toBe('Library · Scriptorium');
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

test('the shell top bar frames every screen: wordmark, nav, theme toggle, account menu', async () => {
  renderAt('/library');
  await screen.findByRole('heading', { name: 'Library' });

  expect(
    screen.getByRole('link', { name: 'Scriptorium home' }),
  ).toHaveAttribute('href', '/');
  for (const label of ['Library', 'Ask', 'History']) {
    expect(screen.getByRole('link', { name: label })).toBeVisible();
  }
  expect(
    screen.getByRole('button', { name: /switch to (dark|light) theme/i }),
  ).toBeVisible();
  expect(screen.getByTestId('user-button')).toBeVisible();
});

test('the theme toggle in the shell drives useTheme().toggle', async () => {
  renderAt('/library');
  await screen.findByRole('heading', { name: 'Library' });

  expect(document.documentElement.classList.contains('dark')).toBe(false);
  await userEvent.click(
    screen.getByRole('button', { name: /switch to dark theme/i }),
  );
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(localStorage.getItem('scriptorium-theme')).toBe('dark');
});

test('the library renders the Console worklist: toolbar count, status chip, row link', async () => {
  renderAt('/library');

  const row = (await screen.findByRole('link', { name: 'Deep Work' })).closest(
    '[data-status]',
  );
  expect(row).not.toBeNull();
  expect(screen.getByRole('link', { name: 'Deep Work' })).toHaveAttribute(
    'href',
    '/books/b1',
  );
  // 8 book_status values collapse to the 4 chip roles.
  expect(screen.getByText('ready')).toBeVisible();
  // mono summary count in the toolbar
  expect(screen.getByText('1 book')).toBeVisible();
});

test('the library toolbar carries the usage meter, linking to /pricing', async () => {
  renderAt('/library');

  await screen.findByRole('heading', { name: 'Library' });
  expect(await screen.findByText('Books 1 / 2')).toBeVisible();
  expect(screen.getByText(/Questions 14 \/ 20 · resets in/)).toBeVisible();
  const meter = screen.getByRole('link', { name: 'View plans and pricing' });
  expect(meter).toHaveAttribute('href', '/pricing');

  await userEvent.click(meter);
  expect(await screen.findByRole('heading', { name: 'Plans' })).toBeVisible();
});

test('hitting the book limit on upload shows the inline notice with live numbers and an Upgrade link', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200 } as Response);
  mockApi.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/me/usage')
      return jsonRes({ ...USAGE, books: { used: 2, limit: 2 } });
    if (path === '/api/v1/books' && init?.method === 'POST')
      return jsonRes({ code: 'book_limit_reached' }, 402);
    if (path === '/api/v1/books') return jsonRes([BOOK]);
    if (path === '/api/v1/books/upload-url')
      return jsonRes({ uploadUrl: 'https://s3.test/put', s3Key: 'k' });
    return jsonRes({ code: 'not_found' }, 404);
  });

  try {
    renderAt('/library');
    await screen.findByRole('heading', { name: 'Library' });

    await userEvent.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['%PDF-1.4'], 'book.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByText(/reached your book limit/i)).toBeVisible();
    expect(screen.getByText(/used 2 of 2 books/i)).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Upgrade to Pro' }),
    ).toHaveAttribute('href', '/pricing');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('/pricing renders the Clerk pricing table, returns to /library, and is absent from the nav', async () => {
  renderAt('/pricing');

  expect(await screen.findByRole('heading', { name: 'Plans' })).toBeVisible();
  const table = screen.getByTestId('pricing-table');
  expect(table).toHaveAttribute('data-redirect', '/library');
  expect(table).toHaveAttribute('data-highlighted', 'pro');

  // Not one of the primary nav links.
  expect(
    screen.queryByRole('link', { name: /pricing|plans/i }),
  ).not.toBeInTheDocument();
});

test('an empty library shows the empty state, not a flash of nothing', async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === '/api/v1/books') return jsonRes([]);
    return jsonRes({ code: 'not_found' }, 404);
  });
  renderAt('/library');

  expect(await screen.findByText('No books yet')).toBeVisible();
});

test('a library load failure surfaces in an alert', async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === '/api/v1/books') return jsonRes({ code: 'boom' }, 500);
    return jsonRes({ code: 'not_found' }, 404);
  });
  renderAt('/library');

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/couldn't load your library/i);
});

test('the active nav link reflects the route', async () => {
  renderAt('/history');
  await screen.findByRole('heading', { name: 'History' });

  expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.getByRole('link', { name: 'Library' })).not.toHaveAttribute(
    'aria-current',
  );
});

test('/how-it-works renders the page and owns the active nav link', async () => {
  renderAt('/how-it-works');

  expect(
    await screen.findByRole('heading', {
      level: 1,
      name: /how scriptorium works/i,
    }),
  ).toBeVisible();

  const link = screen.getByRole('link', { name: 'How it works' });
  expect(link).toHaveAttribute('aria-current', 'page');
  for (const label of ['Library', 'Ask', 'History']) {
    expect(screen.getByRole('link', { name: label })).not.toHaveAttribute(
      'aria-current',
    );
  }
});

test('/activity renders the dashboard and owns the active nav link', async () => {
  renderAt('/activity');

  // A headline tile and the most-asked-books row from the mocked payload.
  expect(await screen.findByText('Books uploaded')).toBeVisible();
  expect(
    screen.getByRole('heading', { level: 1, name: 'Activity' }),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: /Deep Work/ })).toHaveAttribute(
    'href',
    `/books/${ACTIVITY.topBooks[0].bookId}`,
  );

  const link = screen.getByRole('link', { name: 'Activity' });
  expect(link).toHaveAttribute('aria-current', 'page');
});

test('history renders the Console worklist: row link + mono summary count', async () => {
  renderAt('/history');

  const link = await screen.findByRole('link', { name: 'What is focus?' });
  expect(link).toHaveAttribute('href', '/ask/q1');
  expect(screen.getByText('1 question')).toBeVisible();
});

test('a failed history row shows a failed chip and re-asks via /ask?q=', async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === '/api/v1/queries')
      return jsonRes([{ ...QUERY, failed: true }]);
    return jsonRes({ code: 'not_found' }, 404);
  });
  const router = renderAt('/history');

  expect(await screen.findByText('failed')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: /ask again/i }));

  expect(router.state.location.pathname).toBe('/ask');
  expect(router.state.location.search).toBe('?q=What%20is%20focus%3F');
});

test('an empty history shows the empty state, not a flash of nothing', async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === '/api/v1/queries') return jsonRes([]);
    return jsonRes({ code: 'not_found' }, 404);
  });
  renderAt('/history');

  expect(await screen.findByText('No questions yet')).toBeVisible();
});

test('a history load failure surfaces in an alert', async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === '/api/v1/queries') return jsonRes({ code: 'boom' }, 500);
    return jsonRes({ code: 'not_found' }, 404);
  });
  renderAt('/history');

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/couldn't load your questions/i);
});

test('a past query renders its citations and retrieved passages', async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === '/api/v1/queries/q1')
      return jsonRes({
        ...QUERY,
        citations: [
          {
            chunkId: 'c1',
            bookTitle: 'Deep Work',
            chapterTitle: 'Rules',
            chunkText: 'Focus is like a muscle.',
          },
        ],
      });
    return jsonRes({ code: 'not_found' }, 404);
  });
  renderAt('/ask/q1');

  expect(await screen.findByText('Focus is a skill.')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Citations' })).toBeVisible();
  expect(screen.getByText('[1]')).toBeVisible();

  // Passages are collapsed until the disclosure is opened.
  await userEvent.click(
    screen.getByRole('button', { name: /retrieved passages/i }),
  );
  expect(await screen.findByText('Focus is like a muscle.')).toBeVisible();
});

test('a failed past query shows an alert and re-asks via /ask?q=', async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === '/api/v1/queries/q1')
      return jsonRes({ ...QUERY, answer: null, citations: [] });
    return jsonRes({ code: 'not_found' }, 404);
  });
  const router = renderAt('/ask/q1');

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/no answer was generated/i);

  await userEvent.click(screen.getByRole('button', { name: /ask again/i }));
  expect(router.state.location.pathname).toBe('/ask');
  expect(router.state.location.search).toBe('?q=What%20is%20focus%3F');
});

test('a past-query load failure surfaces in an alert', async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === '/api/v1/queries/q1') return jsonRes({ code: 'boom' }, 500);
    return jsonRes({ code: 'not_found' }, 404);
  });
  renderAt('/ask/q1');

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/couldn't load this question/i);
});
