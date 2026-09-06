// A compact "time since" label for a history row, rendered in IBM Plex Mono.
// Deliberately terse (`5m ago`, `3d ago`, `2y ago`) so a dense worklist row
// stays scannable; the row's <time> element keeps the full timestamp in its
// `dateTime` / `title` for hover and assistive tech.
const UNITS: readonly [unit: string, seconds: number][] = [
  ['y', 31_536_000],
  ['mo', 2_592_000],
  ['w', 604_800],
  ['d', 86_400],
  ['h', 3_600],
  ['m', 60],
];

export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  }
  return 'just now';
}
