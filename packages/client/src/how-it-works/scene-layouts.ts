import type { SceneColors } from './theme-colors';

// Where every point sits at each stop, and what colour it is. One fixed set of
// points is reused for the whole journey; each stop supplies a target
// arrangement and the scene lerps towards it, so the reader watches one object
// transform rather than cutting between pictures.

export const POINT_COUNT = 480;

// Deterministic per-point data - a stable "which book" tint and three fixed
// randoms - so the cloud looks organic but never reshuffles between renders.
export type PointSeed = { book: 0 | 1; r: [number, number, number] };

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSeeds(): PointSeed[] {
  const rand = mulberry32(0x5c1b7);
  return Array.from({ length: POINT_COUNT }, () => ({
    book: (rand() < 0.4 ? 1 : 0) as 0 | 1,
    r: [rand(), rand(), rand()] as [number, number, number],
  }));
}

// ~5 evenly spread indices, mixed across both books, that survive the re-rank.
export const KEPT = new Set([37, 96, 188, 205, 331, 402]);

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h || '3d5a80', 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

const gauss = (r: number) => (r - 0.5) * 2;

type Target = { pos: Float32Array; col: Float32Array };

// The three loose thematic clusters the "meaning space" settles into.
const CLUSTERS: [number, number, number][] = [
  [-1.15, 0.55, 0.2],
  [1.2, 0.15, -0.35],
  [0.05, -1.05, 0.35],
];

export function computeTarget(
  stopId: string | undefined,
  seeds: PointSeed[],
  colors: SceneColors,
): Target {
  const pos = new Float32Array(POINT_COUNT * 3);
  const col = new Float32Array(POINT_COUNT * 3);
  const bookA = hexToRgb(colors.bookA);
  const bookB = hexToRgb(colors.bookB);
  const fg = hexToRgb(colors.foreground);
  const bg = hexToRgb(colors.background);
  const structural = mix(bookA, fg, 0.25);

  for (let i = 0; i < POINT_COUNT; i++) {
    const s = seeds[i];
    let x = 0;
    let y = 0;
    let z = 0;
    let c = structural;

    switch (stopId) {
      case 'upload': {
        // A tight book-shaped shell, with a thin column rising above it.
        if (i % 7 === 0) {
          x = gauss(s.r[0]) * 0.12;
          y = 1.3 + s.r[1] * 1.1;
          z = gauss(s.r[2]) * 0.12;
        } else {
          x = gauss(s.r[0]) * 0.78;
          y = gauss(s.r[1]) * 1.05;
          z = gauss(s.r[2]) * 0.18;
        }
        break;
      }
      case 'text': {
        // Points flow into ~11 horizontal lines across the page.
        const row = i % 11;
        x = gauss(s.r[0]) * 0.92;
        y = 0.95 - row * 0.19 + gauss(s.r[1]) * 0.015;
        z = gauss(s.r[2]) * 0.05;
        break;
      }
      case 'chapters': {
        // Four stacked slabs with clear gaps between them.
        const slab = i % 4;
        x = gauss(s.r[0]) * 0.85;
        y = 1.05 - slab * 0.7 + gauss(s.r[1]) * 0.11;
        z = gauss(s.r[2]) * 0.14;
        break;
      }
      case 'passages': {
        // A shallow 3-D lattice - the unit the system works with.
        const nx = 10;
        const ny = 6;
        const gx = i % nx;
        const gy = Math.floor(i / nx) % ny;
        const gz = Math.floor(i / (nx * ny));
        x = (gx / (nx - 1) - 0.5) * 2.5 + gauss(s.r[0]) * 0.06;
        y = (gy / (ny - 1) - 0.5) * 2.3 + gauss(s.r[1]) * 0.06;
        z = (gz / 7 - 0.5) * 1.6 + gauss(s.r[2]) * 0.06;
        break;
      }
      case 'chapter-summaries': {
        // Each cluster collapses tight around a bright core.
        const [cx, cy, cz] = CLUSTERS[i % 3];
        x = cx + gauss(s.r[0]) * 0.22;
        y = cy + gauss(s.r[1]) * 0.22;
        z = cz + gauss(s.r[2]) * 0.22;
        c = mix(s.book ? bookB : bookA, fg, 0.15);
        break;
      }
      case 'ask': {
        // Five translucent book-slabs fanned on a short arc.
        const slab = i % 5;
        const angle = (slab - 2) * 0.32;
        const cx = Math.sin(angle) * 1.5;
        const cz = -Math.cos(angle) * 0.6 + 0.3;
        x = cx + gauss(s.r[0]) * 0.14;
        y = gauss(s.r[1]) * 1.1;
        z = cz + gauss(s.r[2]) * 0.14;
        c = s.book ? bookB : bookA;
        break;
      }
      case 'meaning-space':
      case 'retrieve':
      case 'rerank': {
        const [cx, cy, cz] = CLUSTERS[i % 3];
        x = cx + gauss(s.r[0]) * 0.62;
        y = cy + gauss(s.r[1]) * 0.62;
        z = cz + gauss(s.r[2]) * 0.62;
        c = s.book ? bookB : bookA;
        if (stopId === 'rerank' && !KEPT.has(i)) {
          z -= 1.4;
          c = mix(c, bg, 0.82);
        }
        break;
      }
      default: {
        x = gauss(s.r[0]) * 0.78;
        y = gauss(s.r[1]) * 1.05;
        z = gauss(s.r[2]) * 0.18;
      }
    }

    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }

  return { pos, col };
}

// The book mesh opacity per stop - solid while the book is still a book,
// gone once it has become a cloud.
export function bookOpacityFor(stopId: string | undefined): number {
  switch (stopId) {
    case 'upload':
    case 'text':
      return 1;
    case 'chapters':
      return 0.55;
    case 'passages':
      return 0.18;
    case 'ask':
      return 0.12;
    default:
      return 0;
  }
}

// For `retrieve`: the question point and the indices of its nearest neighbours
// in the settled cloud (so the scene can draw connector lines to them).
export function nearestToQuestion(
  target: Float32Array,
  question: [number, number, number],
  k: number,
): number[] {
  const d: { i: number; dist: number }[] = [];
  for (let i = 0; i < POINT_COUNT; i++) {
    const dx = target[i * 3] - question[0];
    const dy = target[i * 3 + 1] - question[1];
    const dz = target[i * 3 + 2] - question[2];
    d.push({ i, dist: dx * dx + dy * dy + dz * dz });
  }
  d.sort((a, b) => a.dist - b.dist);
  return d.slice(0, k).map((e) => e.i);
}

export const QUESTION_POINT: [number, number, number] = [0.05, -0.15, 0.6];
