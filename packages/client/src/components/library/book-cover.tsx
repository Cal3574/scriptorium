import { coverInitials, coverStyle } from './cover-style';
import { cn } from '@/lib/utils';

// The generated cover tile for a library row (UI polish spec). A muted
// bookcloth colour seeded from the book id, the title's initials stamped in
// Fraunces, and a hairline "spine" down the binding edge. `src`, when a real
// first-page thumbnail eventually exists, replaces the whole tile - callers
// pass it and everything else here is the fallback.
export function BookCover({
  id,
  title,
  src,
  className,
}: {
  id: string;
  title: string | null | undefined;
  src?: string | null;
  className?: string;
}) {
  const shape = cn(
    'relative aspect-[3/4] shrink-0 overflow-hidden rounded-[3px] shadow-xs ring-1 ring-black/10 select-none',
    className,
  );

  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className={cn(shape, 'object-cover')}
      />
    );
  }

  const { bg, fg } = coverStyle(id);
  const initials = coverInitials(title);

  return (
    <span
      aria-hidden="true"
      className={cn(shape, '[container-type:inline-size]')}
      style={{ backgroundColor: bg, color: fg }}
    >
      {/* binding spine */}
      <span className="absolute inset-y-0 left-[3px] w-px bg-current opacity-25" />
      {/* initials sized against the tile (cqw), not the inherited row text */}
      <span className="absolute inset-0 flex items-center justify-center pl-1 font-serif font-semibold tracking-tight [font-size:38cqw]">
        {initials}
      </span>
    </span>
  );
}
