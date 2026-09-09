import { useRef, useState } from 'react';
import { ArrowDownToLineIcon, BanIcon, TriangleAlertIcon } from 'lucide-react';
import { Link } from 'react-router';
import type { BookListItemDto } from '@scriptorium/contracts';

import { cn } from '@/lib/utils';
import {
  checkDrop,
  findDuplicate,
  formatBytes,
  PDF_CONTENT_TYPE,
  UPLOAD_MAX_BYTES,
  type DropRejection,
} from '@/books/upload';
import type { LimitCode } from '@/books/problem';
import { useUsage } from '@/usage/use-usage';
import type { useApi } from '@/auth/use-api';
import { DepositSlip } from './deposit-slip';

type ApiFetch = ReturnType<typeof useApi>;
type Variant = 'compact' | 'panel';

// The one-line reason shown in place when a dropped file is turned away. The
// copy lives here, with the control that renders it - `checkDrop` only returns
// the code.
const REJECTION_COPY: Record<DropRejection, string> = {
  'not-a-pdf': 'Only PDFs',
  'too-many-files': 'Drop one PDF at a time',
  'file-too-large': `Over ${formatBytes(UPLOAD_MAX_BYTES)}`,
};

// The chute frame: ruled and dashed, with a solid top "lip". `idle` sits
// quiet; `over` warms, turns solid, and the lip lifts as the flap opens on
// drag; `spent` is the muted book-limit state.
function chuteClass(variant: Variant, state: 'idle' | 'over' | 'spent') {
  return cn(
    'flex items-center justify-center gap-2 rounded-md border border-dashed border-t-2 transition-colors outline-none select-none focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    variant === 'compact'
      ? 'h-8 min-w-52 px-3'
      : 'min-h-40 w-full flex-col px-6 py-8',
    state === 'idle' &&
      'border-input bg-muted/40 text-muted-foreground hover:border-primary/50 hover:text-foreground',
    state === 'over' &&
      'border-solid border-primary border-t-primary bg-primary/5 text-primary -translate-y-px shadow-[inset_0_2px_0_0_var(--color-primary)]',
    state === 'spent' &&
      'border-border bg-muted/30 text-muted-foreground cursor-not-allowed',
  );
}

// The upload control on the Library screen (replaces the old "Upload PDF"
// button). A chute you feed a PDF: drop one on it, or click to browse. A drop
// never uploads straight away - it opens the deposit slip
// ({@link DepositSlip}) for a look and a deliberate confirm. Rendered
// `compact` in the toolbar and as a large `panel` inside the empty state.
export function DepositSlot({
  api,
  books,
  onUploaded,
  onLimitReached,
  variant = 'compact',
}: {
  api: ApiFetch;
  books: readonly BookListItemDto[];
  onUploaded: () => void;
  onLimitReached: (code: LimitCode) => void;
  variant?: Variant;
}) {
  const { usage } = useUsage();
  // At the plan's book ceiling the chute shows a spent state and takes no
  // file. A quota spent mid-session is still caught by the 402 path and the
  // shared limit-reached notice.
  const atBookLimit = usage ? usage.books.used >= usage.books.limit : false;

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<DropRejection | null>(null);
  // Drives the shake; cleared on `animationend`, and restarted across a rAF so
  // a second rejection in a row replays it.
  const [shaking, setShaking] = useState(false);
  const [pending, setPending] = useState<File | null>(null);

  function take(files: readonly File[]) {
    if (files.length === 0) return;
    const check = checkDrop(files as readonly [File, ...File[]]);
    if (!check.ok) {
      setRejection(check.reason);
      setShaking(false);
      requestAnimationFrame(() => setShaking(true));
      return;
    }
    setRejection(null);
    setPending(check.file);
  }

  function reset() {
    setPending(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  if (atBookLimit) {
    return (
      <div className={cn('flex', variant === 'compact' && 'justify-end')}>
        <div className={chuteClass(variant, 'spent')}>
          <BanIcon className="size-4 shrink-0" />
          <span className={variant === 'panel' ? 'text-sm' : 'text-xs'}>
            Book limit reached ·{' '}
            <Link to="/activity" className="underline underline-offset-2">
              manage on Activity
            </Link>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-1',
        variant === 'compact' && 'items-end',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={PDF_CONTENT_TYPE}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) take([...e.target.files]);
        }}
      />

      <button
        type="button"
        aria-label="Deposit a PDF"
        onClick={() => inputRef.current?.click()}
        onAnimationEnd={() => setShaking(false)}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragging(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take([...e.dataTransfer.files]);
        }}
        className={cn(
          chuteClass(variant, dragging ? 'over' : 'idle'),
          rejection && 'border-status-failed text-status-failed',
          shaking && 'deposit-slot-nudge',
        )}
      >
        <ArrowDownToLineIcon
          className={cn(
            'shrink-0 transition-transform',
            variant === 'panel' ? 'size-5' : 'size-4',
            dragging && '-translate-y-0.5',
          )}
        />
        {variant === 'panel' ? (
          <span className="flex flex-col items-center">
            <span className="text-foreground text-sm font-medium">
              deposit your first title
            </span>
            <span className="text-muted-foreground font-mono text-xs">
              PDF · drag here or browse
            </span>
          </span>
        ) : (
          <span className="font-mono text-xs">deposit a title</span>
        )}
      </button>

      {rejection && (
        <span
          role="alert"
          className="text-status-failed flex items-center gap-1 text-xs"
        >
          <TriangleAlertIcon className="size-3.5" />
          {REJECTION_COPY[rejection]}
        </span>
      )}

      {pending && (
        <DepositSlip
          file={pending}
          duplicateOf={findDuplicate(pending, books)}
          api={api}
          onDeposited={() => {
            reset();
            onUploaded();
          }}
          onLimitReached={(code) => {
            reset();
            onLimitReached(code);
          }}
          onClose={reset}
        />
      )}
    </div>
  );
}
