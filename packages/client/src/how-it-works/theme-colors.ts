// The 3-D stage reads the live design tokens off the document so it matches
// the page in either theme. Dark theme: pale points, additive glow, bloom, on
// the transparent page. Light theme: the same points in the darker light
// tokens, normal blending, no glow or bloom - so they read as ink on the
// white page rather than washing out.
export type SceneColors = {
  primary: string;
  bookA: string;
  bookB: string;
  foreground: string;
  background: string;
  isDark: boolean;
};

// Fallback = the `.dark` tokens from index.css (scriptorium#52), for SSR/tests.
const FALLBACK: SceneColors = {
  primary: '#7d9dc4',
  bookA: '#7d9dc4',
  bookB: '#cf9a45',
  foreground: '#e5e7ec',
  background: '#0e0f13',
  isDark: true,
};

function read(s: CSSStyleDeclaration, name: string, fallback: string): string {
  return s.getPropertyValue(name).trim() || fallback;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h || '000000',
    16,
  );
  return (
    (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) /
    255
  );
}

export function readSceneColors(): SceneColors {
  if (typeof window === 'undefined' || !document.documentElement)
    return FALLBACK;
  const s = getComputedStyle(document.documentElement);
  const primary = read(s, '--primary', FALLBACK.primary);
  const background = read(s, '--background', FALLBACK.background);
  return {
    primary,
    bookA: primary,
    bookB: read(s, '--status-progress', FALLBACK.bookB),
    foreground: read(s, '--foreground', FALLBACK.foreground),
    background,
    isDark: luminance(background) < 0.4,
  };
}
