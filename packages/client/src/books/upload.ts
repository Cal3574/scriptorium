import type { BookListItemDto, CreateUploadUrlResponse } from '@scriptorium/contracts';

import { isLimitReached, problemMessage, type LimitCode } from './problem';
import type { useApi } from '../auth/use-api';

export const PDF_CONTENT_TYPE = 'application/pdf';

// A client-side mirror of the API's `MAX_UPLOAD_BYTES` default
// (`@scriptorium/config`, 50 MiB). The server is still the real gate - it
// answers an over-size upload with `400 file_too_large` - so this constant
// exists only so the deposit slot can turn away an oversize file before it
// wastes a multi-megabyte S3 PUT. If a deployment ever overrides the env var,
// the worst case is the slot letting a slightly-too-big file through to the
// server's own rejection.
export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

type ApiFetch = ReturnType<typeof useApi>;

// `2.4 MB`, `912 KB`, `50 MB` (a trailing `.0` is dropped so the size limit
// reads cleanly in copy). Bytes below 1 KiB are shown raw.
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// The first library book, if any, that looks like the same upload: identical
// original filename AND identical byte size. Deliberately conservative - a
// name clash alone (`book.pdf`) is not enough - because the only consequence
// is a soft "already in your library" warning the reader can override.
export function findDuplicate(
  file: File,
  books: readonly BookListItemDto[],
): BookListItemDto | undefined {
  return books.find(
    (book) =>
      book.originalFilename === file.name &&
      book.fileSizeBytes === file.size,
  );
}

export type DropCheck =
  | { ok: true; file: File }
  | { ok: false; reason: string };

// Guard a drag-drop (or multi-select) payload before the deposit slip opens.
// One PDF, of a sane size, or a one-line reason the slot shows in place.
export function checkDrop(files: readonly File[]): DropCheck {
  if (files.length === 0) return { ok: false, reason: 'No file found' };
  if (files.length > 1) {
    return { ok: false, reason: 'Drop one PDF at a time' };
  }

  const [file] = files;
  // Drag payloads sometimes arrive with an empty `type`; fall back to the
  // extension so a genuine PDF is not turned away.
  const looksPdf =
    file.type === PDF_CONTENT_TYPE ||
    (file.type === '' && file.name.toLowerCase().endsWith('.pdf'));
  if (!looksPdf) return { ok: false, reason: 'Only PDFs' };

  if (file.size === 0) return { ok: false, reason: 'That file is empty' };
  if (file.size > UPLOAD_MAX_BYTES) {
    return { ok: false, reason: `Over ${formatBytes(UPLOAD_MAX_BYTES)}` };
  }

  return { ok: true, file };
}

export type DepositResult =
  | { ok: true }
  | { ok: false; limitCode: LimitCode };

// The three-step presigned-PUT handoff, lifted out of the old `UploadControl`
// so the deposit slip owns it: ask the API for a URL, PUT the bytes straight
// to S3, then register the book. Resolves `{ ok: false, limitCode }` when
// `POST /books` comes back `402` (book quota spent); throws on any other
// failure so the slip can show it and stay open for a retry.
export async function depositBook(
  api: ApiFetch,
  file: File,
): Promise<DepositResult> {
  const urlRes = await api('/api/v1/books/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || PDF_CONTENT_TYPE,
      fileSizeBytes: file.size,
    }),
  });
  if (!urlRes.ok) {
    throw new Error((await problemMessage(urlRes)) ?? 'upload-url failed');
  }
  const { uploadUrl, s3Key } = (await urlRes.json()) as CreateUploadUrlResponse;

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': PDF_CONTENT_TYPE },
    body: file,
  });
  if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);

  const createRes = await api('/api/v1/books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      s3Key,
      originalFilename: file.name,
      fileSizeBytes: file.size,
    }),
  });
  if (!createRes.ok) {
    const limitCode = await isLimitReached(createRes);
    if (limitCode) return { ok: false, limitCode };
    throw new Error((await problemMessage(createRes)) ?? 'create failed');
  }

  return { ok: true };
}
