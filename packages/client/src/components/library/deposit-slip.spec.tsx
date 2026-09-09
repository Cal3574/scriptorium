import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BookListItemDto } from '@scriptorium/contracts';

import { jsonRes } from '@/test-support/http';

const renderPdfPreview = jest.fn();
jest.mock('@/books/pdf-preview', () => ({
  renderPdfPreview: (...args: unknown[]) => renderPdfPreview(...args),
}));

import { DepositSlip } from './deposit-slip';

const api = jest.fn();
const fetchMock = jest.fn();
const onDeposited = jest.fn();
const onLimitReached = jest.fn();
const onClose = jest.fn();

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
  renderPdfPreview.mockResolvedValue({
    pageCount: 12,
    thumbnailUrl: 'data:image/png;base64,AAA',
  });
});

afterEach(() => {
  cleanup();
  api.mockReset();
  fetchMock.mockReset();
  onDeposited.mockReset();
  onLimitReached.mockReset();
  onClose.mockReset();
  renderPdfPreview.mockReset();
});

function file(name = 'deep-work.pdf', size = 1_000_000): File {
  const f = new File(['%PDF'], name, { type: 'application/pdf' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function renderSlip(
  props: Partial<Parameters<typeof DepositSlip>[0]> = {},
) {
  render(
    <DepositSlip
      file={file()}
      duplicateOf={undefined}
      api={api}
      onDeposited={onDeposited}
      onLimitReached={onLimitReached}
      onClose={onClose}
      {...props}
    />,
  );
}

function happyApi() {
  api.mockImplementation(async (path: string) => {
    if (path === '/api/v1/books/upload-url') {
      return jsonRes({
        uploadUrl: 'https://s3.test/put',
        s3Key: 'books/u/1.pdf',
        expiresInSeconds: 300,
      });
    }
    return jsonRes({ id: 'b1' }, 201);
  });
}

test('shows the page count once pdf.js resolves', async () => {
  renderSlip();
  expect(await screen.findByText(/12 pages/)).toBeInTheDocument();
});

test('Deposit runs the handoff and calls onDeposited', async () => {
  happyApi();
  renderSlip();
  await screen.findByText(/12 pages/);

  await userEvent.click(screen.getByRole('button', { name: 'Deposit' }));

  await waitFor(() => expect(onDeposited).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledWith(
    'https://s3.test/put',
    expect.objectContaining({ method: 'PUT' }),
  );
});

test('a duplicate relabels the confirm to "Upload anyway" but still deposits', async () => {
  happyApi();
  const dup = {
    id: 'b1',
    originalFilename: 'deep-work.pdf',
    fileSizeBytes: 1_000_000,
  } as BookListItemDto;
  renderSlip({ duplicateOf: dup });
  await screen.findByText(/12 pages/);
  expect(screen.getByText(/already in your library/)).toBeInTheDocument();

  await userEvent.click(
    screen.getByRole('button', { name: 'Upload anyway' }),
  );
  await waitFor(() => expect(onDeposited).toHaveBeenCalled());
});

test('an S3 failure keeps the slip open with Try again', async () => {
  api.mockImplementation(async (path: string) => {
    if (path === '/api/v1/books/upload-url') {
      return jsonRes({
        uploadUrl: 'https://s3.test/put',
        s3Key: 'k',
        expiresInSeconds: 300,
      });
    }
    return jsonRes({ id: 'b1' }, 201);
  });
  fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);

  renderSlip();
  await screen.findByText(/12 pages/);
  await userEvent.click(screen.getByRole('button', { name: 'Deposit' }));

  expect(
    await screen.findByRole('button', { name: 'Try again' }),
  ).toBeInTheDocument();
  expect(screen.getByText(/S3 upload failed: 503/)).toBeInTheDocument();
  expect(onDeposited).not.toHaveBeenCalled();
});

test('a 402 on register reports the limit and closes', async () => {
  api.mockImplementation(async (path: string) => {
    if (path === '/api/v1/books/upload-url') {
      return jsonRes({
        uploadUrl: 'https://s3.test/put',
        s3Key: 'k',
        expiresInSeconds: 300,
      });
    }
    return jsonRes({ code: 'book_limit_reached' }, 402);
  });

  renderSlip();
  await screen.findByText(/12 pages/);
  await userEvent.click(screen.getByRole('button', { name: 'Deposit' }));

  await waitFor(() =>
    expect(onLimitReached).toHaveBeenCalledWith('book_limit_reached'),
  );
  expect(onClose).toHaveBeenCalled();
  expect(onDeposited).not.toHaveBeenCalled();
});

test('an unreadable PDF blocks the deposit', async () => {
  renderPdfPreview.mockRejectedValue(new Error('InvalidPDFException'));
  renderSlip();

  expect(
    await screen.findByText(/Couldn't read this PDF/),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deposit' })).toBeDisabled();
});

test('the confirm shows a busy label while the handoff is in flight', async () => {
  let release!: () => void;
  api.mockImplementation(
    (path: string) =>
      new Promise((resolve) => {
        if (path === '/api/v1/books/upload-url') {
          release = () =>
            resolve(
              jsonRes({
                uploadUrl: 'https://s3.test/put',
                s3Key: 'k',
                expiresInSeconds: 300,
              }),
            );
        }
      }),
  );

  renderSlip();
  await screen.findByText(/12 pages/);
  await userEvent.click(screen.getByRole('button', { name: 'Deposit' }));

  expect(await screen.findByText('Depositing...')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  release();
});
