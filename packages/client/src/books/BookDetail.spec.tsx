import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { BookDetail } from './BookDetail';

// react-markdown / remark-gfm are pure ESM; render the text straight through.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <>{children}</>,
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

// The live-progress SSE stream: a per-test value, never a real EventSource.
let ingest: {
  progress: unknown;
  connected: boolean;
  deleted: boolean;
} = { progress: null, connected: false, deleted: false };
jest.mock('./use-ingest-events', () => ({
  useIngestEvents: () => ingest,
}));

const api = jest.fn();
jest.mock('../auth/use-api', () => ({ useApi: () => api }));

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

const CHAPTER_READY = {
  id: 'c1',
  chapterIndex: 0,
  title: 'Rules of Focus',
  pageStart: 1,
  pageEnd: 20,
  summary: 'Focus is a skill you train.',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const CHAPTER_PENDING = {
  id: 'c2',
  chapterIndex: 1,
  title: 'Shallow Work',
  pageStart: 21,
  pageEnd: 40,
  summary: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const BOOK = {
  id: 'b1',
  title: 'Deep Work',
  author: 'Cal Newport',
  originalFilename: 'deep-work.pdf',
  fileSizeBytes: 1000,
  pageCount: 40,
  status: 'ready',
  failedStage: null,
  failureReason: null,
  summaryGeneratedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  summary: 'The whole-book summary in prose.',
  chapters: [CHAPTER_READY, CHAPTER_PENDING],
};

function mockBook(overrides: Record<string, unknown> = {}) {
  api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/books/b1' && !init) {
      return jsonRes({ ...BOOK, ...overrides });
    }
    if (path === '/api/v1/books/b1' && init?.method === 'PATCH') {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      return jsonRes({ ...BOOK, ...overrides, ...body });
    }
    if (path === '/api/v1/books/b1/retry') return jsonRes({ ...BOOK });
    return jsonRes({ code: 'not_found' }, 404);
  });
}

function renderDetail() {
  const router = createMemoryRouter(
    [
      { path: '/books/:bookId', element: <BookDetail /> },
      { path: '/library', element: <h1>Library</h1> },
    ],
    { initialEntries: ['/books/b1'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  ingest = { progress: null, connected: false, deleted: false };
  mockBook();
});

afterEach(() => {
  cleanup();
  api.mockReset();
});

test('renders a ScreenHeader with the display title and a BackLink to /library', async () => {
  renderDetail();

  expect(
    await screen.findByRole('heading', { name: 'Deep Work' }),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: /back to library/i }),
  ).toHaveAttribute('href', '/library');
});

test('the header falls back to the filename when the book has no title', async () => {
  mockBook({ title: null });
  renderDetail();

  expect(
    await screen.findByRole('heading', { name: 'deep-work.pdf' }),
  ).toBeVisible();
});

test('shows a skeleton while the detail loads', async () => {
  renderDetail();

  expect(screen.getByTestId('book-detail-skeleton')).toBeInTheDocument();
  // settle so the pending state resolves inside act()
  await screen.findByRole('heading', { name: 'Deep Work' });
});

test('a load error is shown in an alert', async () => {
  api.mockResolvedValue(jsonRes({ detail: 'server exploded' }, 500));
  renderDetail();

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/couldn't load this book/i);
  expect(alert).toHaveTextContent('server exploded');
  expect(
    screen.getByRole('link', { name: /back to library/i }),
  ).toBeInTheDocument();
});

test('the book summary renders via SummaryProse; a null summary shows NotGeneratedYet', async () => {
  renderDetail();
  expect(
    await screen.findByText('The whole-book summary in prose.'),
  ).toBeVisible();

  cleanup();
  api.mockReset();
  mockBook({ summary: null });
  renderDetail();
  expect(await screen.findByText(/no summary generated yet/i)).toBeVisible();
});

test('the chapter index lists every chapter as a link into the reader, never an inline summary', async () => {
  renderDetail();

  const first = await screen.findByRole('link', { name: /Rules of Focus/ });
  expect(first).toHaveAttribute('href', '/books/b1/read/1');
  expect(screen.getByRole('link', { name: /Shallow Work/ })).toHaveAttribute(
    'href',
    '/books/b1/read/2',
  );
  // Book-detail no longer expands a chapter summary in place.
  expect(
    screen.queryByText('Focus is a skill you train.'),
  ).not.toBeInTheDocument();
});

test('a ready book shows a "Read" action linking into the reader; a non-ready book does not', async () => {
  renderDetail();
  const read = await screen.findByRole('link', { name: /^Read$/ });
  expect(read).toHaveAttribute('href', '/books/b1/read');

  cleanup();
  api.mockReset();
  mockBook({ status: 'summarizing' });
  renderDetail();
  await screen.findByRole('heading', { name: 'Deep Work' });
  expect(
    screen.queryByRole('link', { name: /^Read$/ }),
  ).not.toBeInTheDocument();
});

test('a failed book shows the banner headline, raw reason disclosure and retry; finished parts stay visible', async () => {
  mockBook({
    status: 'failed',
    failedStage: 'bookSummary',
    failureReason: 'LLM timeout after 3 retries',
  });
  renderDetail();

  expect(
    await screen.findByText(/we couldn't finish writing the overall summary/i),
  ).toBeVisible();
  // raw reason present behind the disclosure
  expect(screen.getByText('LLM timeout after 3 retries')).toBeInTheDocument();
  // the chapter index still lists the chapters below the banner
  expect(
    screen.getByRole('link', { name: /Rules of Focus/ }),
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /^Retry/ }));
  expect(api).toHaveBeenCalledWith(
    '/api/v1/books/b1/retry',
    expect.objectContaining({ method: 'POST' }),
  );
});

test('a processing book shows its live status line', async () => {
  ingest = {
    progress: {
      status: 'summarizing',
      stage: 'summarizing',
      progress: { done: 2, total: 5, unit: 'chapters' },
    },
    connected: true,
    deleted: false,
  };
  mockBook({ status: 'summarizing' });
  renderDetail();

  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent(/summarize each chapter/i);
  expect(status).toHaveTextContent('2 / 5 chapters');
  expect(status).toHaveTextContent(/live/i);
});

test('EditableField: an empty title is refused, a real value is PATCHed', async () => {
  renderDetail();
  await screen.findByRole('heading', { name: 'Deep Work' });

  await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
  const input = screen.getByRole('textbox', { name: 'title input' });
  await userEvent.clear(input);
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('A title is required.')).toBeVisible();

  await userEvent.type(input, 'Deep Work, Revisited');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(api).toHaveBeenCalledWith(
    '/api/v1/books/b1',
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ title: 'Deep Work, Revisited' }),
    }),
  );
});

test('EditableField: clearing the author sends an explicit null', async () => {
  renderDetail();
  await screen.findByRole('heading', { name: 'Deep Work' });

  await userEvent.click(screen.getByRole('button', { name: 'Edit author' }));
  await userEvent.clear(screen.getByRole('textbox', { name: 'author input' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(api).toHaveBeenCalledWith(
    '/api/v1/books/b1',
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ author: null }),
    }),
  );
});
