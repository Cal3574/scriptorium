import { useRef, useState } from 'react';
import { ArrowDownToLineIcon, BanIcon, TriangleAlertIcon } from 'lucide-react';
import { Link } from 'react-router';
import type { BookListItemDto } from '@scriptorium/contracts';

import { cn } from '@/lib/utils';
import { checkDrop, findDuplicate, PDF_CONTENT_TYPE } from '@/books/upload';
import type { LimitCode } from '@/books/problem';
import type { useApi } from '@/auth/use-api';
import { DepositSlip } from './deposit-slip';

type ApiFetch = ReturnType<typeof useApi>;
type Variant = 'compact' | 'panel';

// The chute frame: ruled, dashed, with a solid top "lip". `idle` sits quiet,
// `over` warms and turns solid on drag, `spent` is the muted book-limit state.
function chuteClass(variant: Variant, state: 'idle' | 'over' | 'spent') {
  return cn(
    'flex items-center justify-center gap-2 rounded-md border border-dashed border-t-input transition-colors outline-none select-none focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    variant === 'compact'
      ? 'h-8 min-w-52 px-3'
      : 'min-h-40 w-full flex-col px-6 py-8',
    state === 'idle' &&
      'border-input bg-muted/40 text-muted-foreground hover:border-primary/50 hover:text-foreground',
    state === 'over' &&
      'border-primary border-solid bg-primary/5 text-primary',
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
  atBookLimit,
  onUploaded,
  onLimitReached,
  variant = 'compact',
}: {
  api: ApiFetch;
  books: readonly BookListItemDto[];
  // The reader is at their plan's book ceiling: the chute shows a spent state
  // and takes no file. A quota spent mid-session is still caught by the 402
  // path and the shared limit-reached notice.
  atBookLimit: boolean;
  onUploaded: () => void;
  onLimitReached: (code: LimitCode) => void;
  variant?: Variant;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [pending, setPending] = useState<File | null>(null);

  function take(files: readonly File[]) {
    setRejection(null);
    const check = checkDrop(files);
    if (!check.ok) {
      setRejection(check.reason);
      return;
    }
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
        className={chuteClass(variant, dragging ? 'over' : 'idle')}
      >
        <ArrowDownToLineIcon
          className={cn(
            'shrink-0 transition-transform',
            variant === 'panel' ? 'size-5' : 'size-4',
            dragging && '-translate-y-px',
          )}
        />
        {variant === 'panel' ? (
          <span className="flex flex-col items-center">
            <span className="text-foreground text-sm font-medium">
              Deposit your first title
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
          {rejection}
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
