import { useRef, useState } from 'react';
import { UploadIcon } from 'lucide-react';
import type { CreateUploadUrlResponse } from '@scriptorium/contracts';

import { Button } from '@/components/ui/button';
import { problemMessage } from '@/books/problem';
import type { useApi } from '@/auth/use-api';

const PDF_CONTENT_TYPE = 'application/pdf';

type ApiFetch = ReturnType<typeof useApi>;

// The "Upload PDF" action in the toolbar (#54). Behaviour is unchanged from
// the original form: the same three-step presigned-PUT flow (ask the API for
// a URL -> PUT the bytes straight to S3 -> register the book). Only the
// trigger changed - picking a file starts the upload straight away, so the
// toolbar keeps a single button.
export function UploadControl({
  api,
  onUploaded,
}: {
  api: ApiFetch;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      // 1. Ask the API for a presigned PUT pinned to a key it chooses.
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
      const { uploadUrl, s3Key } =
        (await urlRes.json()) as CreateUploadUrlResponse;

      // 2. PUT the bytes straight to S3 - never through the API.
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': PDF_CONTENT_TYPE },
        body: file,
      });
      if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);

      // 3. Register the book; the API verifies the object and enqueues ingest.
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
        throw new Error((await problemMessage(createRes)) ?? 'create failed');
      }

      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept={PDF_CONTENT_TYPE}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon />
        {busy ? 'Uploading...' : 'Upload PDF'}
      </Button>
      {error && (
        <span role="alert" className="text-status-failed text-xs">
          {error}
        </span>
      )}
    </div>
  );
}
