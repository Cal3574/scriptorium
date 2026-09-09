import type { BookListItemDto } from '@scriptorium/contracts';

import { jsonRes } from '@/test-support/http';
import {
  checkDrop,
  depositBook,
  findDuplicate,
  formatBytes,
  UPLOAD_MAX_BYTES,
} from './upload';

function pdf(name: string, size: number): File {
  const f = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function book(overrides: Partial<BookListItemDto> = {}): BookListItemDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: null,
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

describe('formatBytes', () => {
  it('shows one decimal for megabytes and drops a trailing .0', () => {
    expect(formatBytes(2_411_724)).toBe('2.3 MB');
    expect(formatBytes(UPLOAD_MAX_BYTES)).toBe('50 MB');
  });

  it('rounds to whole kilobytes below a megabyte', () => {
    expect(formatBytes(912_000)).toBe('891 KB');
  });

  it('shows raw bytes below a kilobyte', () => {
    expect(formatBytes(512)).toBe('512 B');
  });
});

describe('findDuplicate', () => {
  it('matches on identical filename and exact size', () => {
    const hit = findDuplicate(pdf('atomic-habits.pdf', 2_400_000), [book()]);
    expect(hit?.id).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('ignores a same-name file of a different size', () => {
    expect(
      findDuplicate(pdf('atomic-habits.pdf', 9_999), [book()]),
    ).toBeUndefined();
  });

  it('ignores a same-size file with a different name', () => {
    expect(
      findDuplicate(pdf('deep-work.pdf', 2_400_000), [book()]),
    ).toBeUndefined();
  });
});

describe('checkDrop', () => {
  it('accepts a single sane PDF', () => {
    const result = checkDrop([pdf('book.pdf', 1_000_000)]);
    expect(result.ok).toBe(true);
  });

  it('rejects more than one file', () => {
    expect(checkDrop([pdf('a.pdf', 10), pdf('b.pdf', 10)])).toEqual({
      ok: false,
      reason: 'too-many-files',
    });
  });

  it('rejects a non-PDF by type', () => {
    const epub = new File(['x'], 'book.epub', {
      type: 'application/epub+zip',
    });
    expect(checkDrop([epub])).toEqual({ ok: false, reason: 'not-a-pdf' });
  });

  it('accepts a typeless payload that has a .pdf extension', () => {
    const f = new File(['x'], 'book.pdf', { type: '' });
    Object.defineProperty(f, 'size', { value: 10 });
    expect(checkDrop([f]).ok).toBe(true);
  });

  it('rejects an oversize PDF', () => {
    expect(checkDrop([pdf('big.pdf', UPLOAD_MAX_BYTES + 1)])).toEqual({
      ok: false,
      reason: 'file-too-large',
    });
  });

  it('leaves a 0-byte PDF for pdf.js and the server to reject', () => {
    expect(checkDrop([pdf('empty.pdf', 0)]).ok).toBe(true);
  });
});

describe('depositBook', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
  });
  afterEach(() => {
    fetchMock.mockReset();
  });

  it('walks url -> S3 PUT -> register and resolves ok', async () => {
    const api = jest.fn(async (path: string) => {
      if (path === '/api/v1/books/upload-url') {
        return jsonRes({
          uploadUrl: 'https://s3.test/put',
          s3Key: 'books/u/1.pdf',
          expiresInSeconds: 300,
        });
      }
      return jsonRes({ id: 'b1' }, 201);
    });

    await expect(depositBook(api, pdf('book.pdf', 10))).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://s3.test/put',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('returns the limit code on a 402 from register', async () => {
    const api = jest.fn(async (path: string) => {
      if (path === '/api/v1/books/upload-url') {
        return jsonRes({
          uploadUrl: 'https://s3.test/put',
          s3Key: 'k',
          expiresInSeconds: 300,
        });
      }
      return jsonRes({ code: 'book_limit_reached' }, 402);
    });

    await expect(depositBook(api, pdf('book.pdf', 10))).resolves.toEqual({
      ok: false,
      limitCode: 'book_limit_reached',
    });
  });

  it('throws on a non-limit register failure', async () => {
    const api = jest.fn(async (path: string) => {
      if (path === '/api/v1/books/upload-url') {
        return jsonRes({
          uploadUrl: 'https://s3.test/put',
          s3Key: 'k',
          expiresInSeconds: 300,
        });
      }
      return jsonRes({ detail: 'bad file' }, 400);
    });

    await expect(depositBook(api, pdf('book.pdf', 10))).rejects.toThrow(
      'bad file',
    );
  });

  it('throws when the S3 PUT fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    const api = jest.fn(async () =>
      jsonRes({ uploadUrl: 'https://s3.test/put', s3Key: 'k', expiresInSeconds: 300 }),
    );

    await expect(depositBook(api, pdf('book.pdf', 10))).rejects.toThrow(
      'S3 upload failed: 503',
    );
  });
});
