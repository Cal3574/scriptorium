// The 3-D stage blends into the page - it reads the *live* design tokens off
// the document so its palette, background and glow match whatever theme the
// rest of the page is in, and there is no separate "viewport" look.
export type SceneColors = {
  primary: string;
  bookA: string;
  bookB: string;
  foreground: string;
  background: string;
  /** Additive glow only reads on a dark ground; drives blend-mode choices. */
  isDark: boolean;
};

// Fallback = the `.dark` tokens from index.css (scriptorium#52), used when the
// document is not available (SSR, tests).
const FALLBACK: SceneColors = {
  primary: '#7d9dc4',
  bookA: '#7d9dc4',
  bookB: '#cf9a45',
  foreground: '#e5e7ec',
  background: '#0e0f13',
  isDark: true,
};

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string) {
  return styles.getPropertyValue(name).trim() || fallback;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h || '000000',
    16,
  );
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function readSceneColors(): SceneColors {
  if (typeof window === 'undefined' || !document.documentElement)
    return FALLBACK;
  const s = getComputedStyle(document.documentElement);
  const primary = readVar(s, '--primary', FALLBACK.primary);
  const background = readVar(s, '--background', FALLBACK.background);
  return {
    primary,
    bookA: primary,
    bookB: readVar(s, '--status-progress', FALLBACK.bookB),
    foreground: readVar(s, '--foreground', FALLBACK.foreground),
    background,
    isDark: luminance(background) < 0.4,
  };
}
