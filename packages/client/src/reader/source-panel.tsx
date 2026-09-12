import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Skeleton } from '@/components/ui/skeleton';
import { SummaryProse } from '@/components/prose/summary-prose';
import type { ChapterSourceState } from './use-chapter-source';

// The `?view=source` column: the reconstructed source text, or one of the
// quiet non-error states (still-loading, no usable text, book gone). The
// chapter summary is always one click away on the strip, so nothing here is
// fatal.
export function SourcePanel({
  state,
  range,
}: {
  state: ChapterSourceState;
  range: string | null;
}) {
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="space-y-2" data-testid="source-loading">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  if (state.status === 'gone') {
    return (
      <ReaderNote>
        This book is no longer available.{' '}
        <Link to="/library" className="underline">
          Back to the library
        </Link>
        .
      </ReaderNote>
    );
  }

  if (state.status === 'error') {
    return (
      <ReaderNote>Couldn&apos;t load the source for this chapter.</ReaderNote>
    );
  }

  const { source } = state;
  if (!source.available || source.text == null) {
    return (
      <ReaderNote>
        The original pages for this chapter don&apos;t hold readable text. The
        summary is unaffected.
      </ReaderNote>
    );
  }

  return (
    <div>
      <p className="text-muted-foreground border-border m-0 mb-5 inline-block rounded border px-2 py-1 font-mono text-[10.5px] tracking-[0.06em] uppercase">
        Reconstructed from source{range ? ` · pp. ${range}` : ''}
      </p>
      <SummaryProse markdown={source.text} className="prose--reading" />
      {source.truncated && (
        <p className="text-muted-foreground mt-6 text-xs italic">
          This chapter&apos;s source text is long and has been trimmed here.
        </p>
      )}
    </div>
  );
}

function ReaderNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="note"
      className="border-border text-muted-foreground rounded border border-dashed px-6 py-10 text-center text-[12.5px]"
    >
      {children}
    </p>
  );
}
