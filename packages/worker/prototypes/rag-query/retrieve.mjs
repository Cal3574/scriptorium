// THROWAWAY PROTOTYPE - candidate retrieval strategies for wayfinder #11.
import { openai, CONFIG, loadStore } from './lib.mjs';

export async function embedQuestion(question) {
  const res = await openai.embeddings.create({
    model: CONFIG.embeddingModel,
    input: question,
    dimensions: CONFIG.embeddingDimensions,
  });
  return res.data[0].embedding;
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
// text-embedding-3 vectors are L2-normalised, so cosine sim == dot product,
// and cosine distance (pgvector `<=>`) == 1 - dot.
const cosine = dot;

let STORE = null;
const getStore = () => (STORE ??= loadStore());

// Brute-force cosine top-N. In production this is the pgvector HNSW query:
//   order by embedding <=> $q where embedding is not null [and book_id = $b] limit N
export async function candidatePool(qvec, { poolSize = 50, bookId = null } = {}) {
  const rows = getStore().filter((r) => (bookId ? r.book_id === bookId : true));
  return rows
    .map((r) => {
      const similarity = cosine(qvec, r.embedding);
      return { ...r, similarity, distance: 1 - similarity };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, poolSize);
}

// ---- strategies: pool -> ordered selection -----------------------------------

export const plainTopK = (candidates, { k = 12 } = {}) => candidates.slice(0, k);

export function similarityThreshold(candidates, { minSimilarity = 0.3, kMax = 16, kMin = 3 } = {}) {
  const kept = candidates.filter((c) => c.similarity >= minSimilarity).slice(0, kMax);
  return kept.length >= kMin ? kept : candidates.slice(0, kMin);
}

export function perChapterCap(candidates, { k = 12, maxPerChapter = 3 } = {}) {
  const seen = new Map();
  const out = [];
  for (const c of candidates) {
    const n = seen.get(c.chapter_id) || 0;
    if (n >= maxPerChapter) continue;
    seen.set(c.chapter_id, n + 1);
    out.push(c);
    if (out.length === k) break;
  }
  return out;
}

// Per-book cap that BACKFILLS: take up to maxPerBook of each book in rank order,
// then if still short of k, fill the remainder from the leftovers (rank order).
export function perBookCap(candidates, { k = 12, maxPerBook = 6 } = {}) {
  const seen = new Map();
  const primary = [];
  const leftover = [];
  for (const c of candidates) {
    const n = seen.get(c.book_id) || 0;
    if (n < maxPerBook) { seen.set(c.book_id, n + 1); primary.push(c); }
    else leftover.push(c);
  }
  return [...primary, ...leftover].slice(0, k);
}

// The candidate for the spec: cosine top-k, per-book cap w/ backfill, absolute
// similarity floor. Returns { chunks, lowConfidence } - lowConfidence tells the
// synthesis layer to lean toward "not enough context".
export function recommended(
  candidates,
  { k = 12, maxPerBook = 6, floor = 0.25, kMinOnLowConf = 4 } = {},
) {
  const capped = perBookCap(candidates, { k: candidates.length, maxPerBook });
  const aboveFloor = capped.filter((c) => c.similarity >= floor).slice(0, k);
  if (aboveFloor.length >= 3) return { chunks: aboveFloor, lowConfidence: false };
  return { chunks: capped.slice(0, kMinOnLowConf), lowConfidence: true };
}

export function mmr(candidates, { k = 12, lambda = 0.7 } = {}) {
  const selected = [];
  const rest = [...candidates];
  while (selected.length < k && rest.length) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      const maxSimToSelected = selected.length
        ? Math.max(...selected.map((s) => cosine(c.embedding, s.embedding)))
        : 0;
      const score = lambda * c.similarity - (1 - lambda) * maxSimToSelected;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    selected.push(rest.splice(bestIdx, 1)[0]);
  }
  return selected;
}

// MMR + a hard per-chapter cap - the candidate for the spec.
export function mmrCapped(candidates, { k = 12, lambda = 0.7, maxPerChapter = 3 } = {}) {
  const ranked = mmr(candidates, { k: candidates.length, lambda });
  return perChapterCap(ranked, { k, maxPerChapter });
}

export const STRATEGIES = {
  'plain-k6': (c) => plainTopK(c, { k: 6 }),
  'plain-k12': (c) => plainTopK(c, { k: 12 }),
  'plain-k16': (c) => plainTopK(c, { k: 16 }),
  'threshold-0.30': (c) => similarityThreshold(c, { minSimilarity: 0.3 }),
  'perChapterCap-k12-3': (c) => perChapterCap(c, { k: 12, maxPerChapter: 3 }),
  'mmr-k12-0.7': (c) => mmr(c, { k: 12, lambda: 0.7 }),
  'mmrCapped-k12-0.7-3': (c) => mmrCapped(c, { k: 12, lambda: 0.7, maxPerChapter: 3 }),
  'perBookCap-k12-6': (c) => perBookCap(c, { k: 12, maxPerBook: 6 }),
  'RECOMMENDED': (c) => recommended(c, {}).chunks,
};

export function diversityStats(selection) {
  const books = new Set(selection.map((s) => s.book_title));
  const chapters = new Set(selection.map((s) => s.chapter_id));
  const tokens = selection.reduce((s, c) => s + c.token_count, 0);
  const sims = selection.map((s) => s.similarity);
  return {
    n: selection.length,
    books: books.size,
    chapters: chapters.size,
    tokens,
    simMax: Math.max(...sims),
    simMin: Math.min(...sims),
  };
}
