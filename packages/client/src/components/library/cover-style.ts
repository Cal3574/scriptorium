// Generated book covers for the library worklist (UI polish spec). Nothing
// visual is stored server-side yet, so each row gets a deterministic "cloth"
// tile seeded from the book id: a muted bookbinding colour under the title in
// Fraunces. The palette is self-contained (its own foreground) so a tile
// reads the same in light and dark; when a real first-page thumbnail lands
// later it simply replaces the tile.

export interface CoverStyle {
  bg: string;
  fg: string;
}

// Muted bookcloth tones. The first is the Scriptorium slate (#52 --primary);
// the rest are picked to sit beside it without clashing. Warm paper-white
// foreground throughout for the stamped-initials look.
const PAPER = '#f4efe4';
export const COVER_PALETTE: readonly CoverStyle[] = [
  { bg: '#3d5a80', fg: PAPER }, // slate
  { bg: '#7c4b52', fg: PAPER }, // oxblood
  { bg: '#40614d', fg: PAPER }, // forest
  { bg: '#8a6a3c', fg: PAPER }, // ochre
  { bg: '#3a3f52', fg: PAPER }, // ink
  { bg: '#5e4b6e', fg: PAPER }, // plum
  { bg: '#3a6068', fg: PAPER }, // teal
  { bg: '#8a5a4a', fg: PAPER }, // clay
];

// djb2 - small, stable, and good enough to scatter ids across the palette.
function hash(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function coverStyle(id: string): CoverStyle {
  return COVER_PALETTE[hash(id) % COVER_PALETTE.length];
}

const ARTICLES = new Set(['the', 'a', 'an']);

// Up to two stamped letters for the cover. Leading articles are skipped when a
// more distinctive word follows ("The Pragmatic Programmer" -> "PP"); a single
// word gives its first two letters ("Meditations" -> "ME").
export function coverInitials(title: string | null | undefined): string {
  const words = (title ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  const significant =
    words.length > 1 && ARTICLES.has(words[0].toLowerCase())
      ? words.slice(1)
      : words;

  if (significant.length === 1) {
    return significant[0].slice(0, 2).toUpperCase();
  }
  return (significant[0][0] + significant[1][0]).toUpperCase();
}
