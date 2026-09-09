import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { BookListItemDto } from '@scriptorium/contracts';

// pdf.js never runs under jsdom; the slip only needs a page count + a cover.
jest.mock('@/books/pdf-preview', () => ({
  renderPdfPreview: jest.fn(async () => ({
    pageCount: 42,
    thumbnailUrl: 'data:image/png;base64,AAA',
  })),
}));

import { DepositSlot } from './deposit-slot';

const api = jest.fn();
const onUploaded = jest.fn();
const onLimitReached = jest.fn();

afterEach(() => {
  cleanup();
  api.mockReset();
  onUploaded.mockReset();
  onLimitReached.mockReset();
});

function book(overrides: Partial<BookListItemDto> = {}): BookListItemDto {
  return {
    id: 'b1',
    title: 'Atomic Habits',
    author: null,
    originalFilename: 'atomic-habits.pdf',
    fileSizeBytes: 2_400_000,
    pageCount: null,
    status: 'ready',
    failedStage: null,
    failureReason: null,
    summaryGeneratedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as BookListItemDto;
}

function renderSlot(props: Partial<Parameters<typeof DepositSlot>[0]> = {}) {
  render(
    <MemoryRouter>
      <DepositSlot
        api={api}
        books={[]}
        atBookLimit={false}
        onUploaded={onUploaded}
        onLimitReached={onLimitReached}
        {...props}
      />
    </MemoryRouter>,
  );
}

function pdfFile(name: string, size: number): File {
  const f = new File(['%PDF-1.4'], name, { type: 'application/pdf' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function dropOn(el: Element, files: File[]) {
  fireEvent.drop(el, { dataTransfer: { files, types: ['Files'] } });
}

test('picking a valid PDF opens the deposit slip with its name and page count', async () => {
  renderSlot();
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await userEvent.upload(input, pdfFile('deep-work.pdf', 1_000_000));

  expect(await screen.findByText('Deposit slip')).toBeInTheDocument();
  expect(screen.getByText('deep-work.pdf')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByText(/42 pages/)).toBeInTheDocument(),
  );
});

test('a non-PDF drop is rejected at the slot, no slip', () => {
  renderSlot();
  const chute = screen.getByRole('button', { name: 'Deposit a PDF' });
  dropOn(chute, [new File(['x'], 'notes.txt', { type: 'text/plain' })]);

  expect(screen.getByRole('alert')).toHaveTextContent('Only PDFs');
  expect(screen.queryByText('Deposit slip')).not.toBeInTheDocument();
});

test('dropping more than one file is rejected', () => {
  renderSlot();
  const chute = screen.getByRole('button', { name: 'Deposit a PDF' });
  dropOn(chute, [pdfFile('a.pdf', 10), pdfFile('b.pdf', 10)]);

  expect(screen.getByRole('alert')).toHaveTextContent('Drop one PDF at a time');
});

test('an oversize PDF is rejected with the limit', () => {
  renderSlot();
  const chute = screen.getByRole('button', { name: 'Deposit a PDF' });
  dropOn(chute, [pdfFile('big.pdf', 60 * 1024 * 1024)]);

  expect(screen.getByRole('alert')).toHaveTextContent('Over 50 MB');
});

test('a matching filename + size shows the duplicate warning and "Upload anyway"', async () => {
  renderSlot({ books: [book()] });
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await userEvent.upload(input, pdfFile('atomic-habits.pdf', 2_400_000));

  expect(
    await screen.findByText(/already in your library/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Upload anyway' }),
  ).toBeInTheDocument();
});

test('at the book limit the slot is spent and takes no file', () => {
  renderSlot({ atBookLimit: true });
  expect(screen.getByText(/Book limit reached/)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Deposit a PDF' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'manage on Activity' })).toHaveAttribute(
    'href',
    '/activity',
  );
});
