import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { UploadControl } from './upload-control';

function jsonRes(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

const api = jest.fn();
const onUploaded = jest.fn();
const onLimitReached = jest.fn();
const fetchMock = jest.fn();

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
});

afterEach(() => {
  cleanup();
  api.mockReset();
  onUploaded.mockReset();
  onLimitReached.mockReset();
  fetchMock.mockReset();
});

function renderControl() {
  render(
    <UploadControl
      api={api}
      onUploaded={onUploaded}
      onLimitReached={onLimitReached}
    />,
  );
}

async function pickFile() {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await userEvent.upload(
    input,
    new File(['%PDF-1.4'], 'book.pdf', { type: 'application/pdf' }),
  );
}

test('a 402 on register calls onLimitReached with the code, not the error span', async () => {
  api.mockImplementation(async (path: string) => {
    if (path === '/api/v1/books/upload-url')
      return jsonRes({ uploadUrl: 'https://s3.test/put', s3Key: 'k' });
    if (path === '/api/v1/books')
      return jsonRes({ code: 'book_limit_reached' }, 402);
    return jsonRes({ code: 'not_found' }, 404);
  });
  renderControl();
  await pickFile();

  await waitFor(() =>
    expect(onLimitReached).toHaveBeenCalledWith('book_limit_reached'),
  );
  expect(onUploaded).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a non-limit failure on register still surfaces the inline error', async () => {
  api.mockImplementation(async (path: string) => {
    if (path === '/api/v1/books/upload-url')
      return jsonRes({ uploadUrl: 'https://s3.test/put', s3Key: 'k' });
    if (path === '/api/v1/books') return jsonRes({ detail: 'bad file' }, 400);
    return jsonRes({ code: 'not_found' }, 404);
  });
  renderControl();
  await pickFile();

  expect(await screen.findByRole('alert')).toHaveTextContent('bad file');
  expect(onLimitReached).not.toHaveBeenCalled();
});
