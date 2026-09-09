// The first-run preview above the library empty state: three faint outlined
// cover shapes, gently fanned, so a brand-new account sees what a populated
// shelf will look like before it has a single book. Purely decorative.
export function EmptyShelf() {
  return (
    <div
      aria-hidden="true"
      className="flex items-end justify-center gap-2 pb-1"
    >
      {[-6, 0, 6].map((rotate, i) => (
        <span
          key={i}
          className="border-border bg-muted/40 aspect-[3/4] w-12 rounded-[3px] border border-dashed"
          style={{ transform: `rotate(${rotate}deg)` }}
        />
      ))}
    </div>
  );
}
