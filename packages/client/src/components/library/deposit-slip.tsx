import { useEffect, useState, type ReactNode } from 'react';
import { Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import type { BookListItemDto } from '@scriptorium/contracts';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PdfPreview } from '@/books/pdf-preview';
import { depositBook, formatBytes } from '@/books/upload';
import type { LimitCode } from '@/books/problem';
import type { useApi } from '@/auth/use-api';

type ApiFetch = ReturnType<typeof useApi>;

// pdf.js parse state for the first-page cover + page count.
type Preview =
  | { state: 'loading' }
  | { state: 'ready'; preview: PdfPreview }
  | { state: 'error' };

type Phase =
  | { name: 'idle' }
  | { name: 'depositing' }
  | { name: 'failed'; message: string };

// The confirmation modal that opens once a PDF has been picked or dropped,
// before any bytes leave the browser. Styled as a paper deposit slip: the
// first page as a cover, the filename, the size and page count, and a
// deliberate Deposit. It owns the whole three-step handoff (`depositBook`) and
// keeps itself open through it, so an S3 or register error lands right here
// with a Try again.
export function DepositSlip({
  file,
  duplicateOf,
  api,
  onDeposited,
  onLimitReached,
  onClose,
}: {
  file: File;
  // The library book this upload appears to duplicate (same filename + exact
  // size), if any. A soft warning only - the reader can still deposit.
  duplicateOf: BookListItemDto | undefined;
  api: ApiFetch;
  onDeposited: () => void;
  onLimitReached: (code: LimitCode) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview>({ state: 'loading' });
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });

  useEffect(() => {
    let live = true;
    setPreview({ state: 'loading' });
    // pdf.js is ~450 kB; keep it out of the main bundle and pull it only when
    // a slip actually opens.
    import('@/books/pdf-preview')
      .then(({ renderPdfPreview }) => renderPdfPreview(file))
      .then((p) => live && setPreview({ state: 'ready', preview: p }))
      .catch(() => live && setPreview({ state: 'error' }));
    return () => {
      live = false;
    };
  }, [file]);

  const depositing = phase.name === 'depositing';
  const unreadable = preview.state === 'error';
  const canDeposit = preview.state === 'ready' && !depositing;

  async function deposit() {
    setPhase({ name: 'depositing' });
    try {
      const result = await depositBook(api, file);
      if (result.ok) {
        onDeposited();
        return;
      }
      onLimitReached(result.limitCode);
      onClose();
    } catch (err) {
      setPhase({
        name: 'failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // A close request (Esc, backdrop, the X, Cancel) is honoured only while no
  // deposit is in flight - the PUT cannot be cancelled cleanly.
  function requestClose() {
    if (!depositing) onClose();
  }

  const confirmLabel = depositing
    ? 'Depositing…'
    : duplicateOf
      ? 'Upload anyway'
      : 'Deposit';

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        showCloseButton={!depositing}
        onEscapeKeyDown={(e) => depositing && e.preventDefault()}
        onPointerDownOutside={(e) => depositing && e.preventDefault()}
        onInteractOutside={(e) => depositing && e.preventDefault()}
        className="gap-0 p-0"
      >
        <DialogHeader className="border-border border-b px-5 py-3">
          <DialogTitle className="font-mono text-[11px] font-medium tracking-[0.14em] uppercase">
            Deposit slip
          </DialogTitle>
          <DialogDescription className="sr-only">
            Review {file.name} ({formatBytes(file.size)}) before it is added to
            your library.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 px-5 py-5">
          <Cover preview={preview} />

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-foreground font-mono text-sm break-all">
              {file.name}
            </p>
            <p className="text-muted-foreground font-mono text-xs tabular-nums">
              {formatBytes(file.size)}
              {preview.state === 'ready' &&
                ` · ${preview.preview.pageCount} ${
                  preview.preview.pageCount === 1 ? 'page' : 'pages'
                }`}
            </p>

            {unreadable && (
              <Notice>
                Couldn&apos;t read this PDF - it may be corrupt or
                password-protected.
              </Notice>
            )}
            {duplicateOf && !unreadable && (
              <Notice>
                &ldquo;{file.name}&rdquo; ({formatBytes(file.size)}) is already
                in your library.
              </Notice>
            )}
            {phase.name === 'failed' && (
              <Notice>{phase.message}</Notice>
            )}
          </div>
        </div>

        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={requestClose}
            disabled={depositing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void deposit()}
            disabled={!canDeposit && phase.name !== 'failed'}
          >
            {depositing && <Loader2Icon className="animate-spin" />}
            {phase.name === 'failed' ? 'Try again' : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The first-page cover: a skeleton while pdf.js works, the rendered page once
// ready, a muted placard if it could not be read.
function Cover({ preview }: { preview: Preview }) {
  const frame =
    'border-border bg-muted h-32 w-24 shrink-0 overflow-hidden rounded-sm border';

  if (preview.state === 'ready') {
    return (
      <img
        src={preview.preview.thumbnailUrl}
        alt=""
        className={`${frame} object-cover object-top`}
      />
    );
  }
  if (preview.state === 'error') {
    return (
      <div
        className={`${frame} text-muted-foreground flex items-center justify-center`}
      >
        <TriangleAlertIcon className="size-5" />
      </div>
    );
  }
  return (
    <div className={`${frame} flex items-center justify-center`}>
      <Loader2Icon className="text-muted-foreground size-5 animate-spin" />
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="text-status-failed mt-1.5 flex items-start gap-1.5 text-xs"
    >
      <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
