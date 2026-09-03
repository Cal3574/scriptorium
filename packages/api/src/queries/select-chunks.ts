// The RAG selection step: pure, deterministic re-ranking of the candidate pool
// down to the final <=12 chunks the LLM sees. No database, no clock, no
// randomness - unit-tested directly with fixture candidate arrays.
// See docs/wayfinder/rag-query-spec.md section 2.4.

// One row from the pgvector candidate query, similarity already computed as
// `1 - (embedding <=> $q)`.
export interface Candidate {
  chunkId: string;
  bookId: string;
  bookTitle: string;
  chapterTitle: string;
  chunkText: string;
  similarity: number;
}

export interface SelectionConfig {
  topK: number;
  maxPerBook: number;
  minSimilarity: number;
  minResults: number;
  lowConfidenceK: number;
}

export interface SelectionResult {
  selected: Candidate[];
  // True when retrieval returned weak matches: biases synthesis toward "not
  // enough context". The client still shows the (weak) chunks underneath.
  lowConfidence: boolean;
}

// Per-book cap with backfill: walk the pool in similarity order, take at most
// `maxPerBook` from any one book into `primary` and the rest into `leftover`,
// then concatenate. This stops one book monopolising a comparative question
// without ever starving a single-book question - the leftovers backfill.
function perBookCapWithBackfill(
  candidates: Candidate[],
  maxPerBook: number,
): Candidate[] {
  const perBook = new Map<string, number>();
  const primary: Candidate[] = [];
  const leftover: Candidate[] = [];
  for (const candidate of candidates) {
    const taken = perBook.get(candidate.bookId) ?? 0;
    if (taken < maxPerBook) {
      perBook.set(candidate.bookId, taken + 1);
      primary.push(candidate);
    } else {
      leftover.push(candidate);
    }
  }
  return [...primary, ...leftover];
}

/**
 * Reduce the candidate pool to the final set, applying, in order:
 *
 *  1. per-book cap `maxPerBook` with backfill;
 *  2. absolute similarity floor `minSimilarity`, then take the first `topK`;
 *  3. if fewer than `minResults` clear the floor, drop the floor, take the
 *     top `lowConfidenceK` of the capped pool, and set `lowConfidence`.
 *
 * The input is assumed to already be in descending similarity order (the SQL
 * `ORDER BY embedding <=> $q`); it is not re-sorted here.
 */
export function selectChunks(
  candidates: Candidate[],
  config: SelectionConfig,
): SelectionResult {
  const capped = perBookCapWithBackfill(candidates, config.maxPerBook);

  const aboveFloor = capped
    .filter((c) => c.similarity >= config.minSimilarity)
    .slice(0, config.topK);

  if (aboveFloor.length >= config.minResults) {
    return { selected: aboveFloor, lowConfidence: false };
  }

  return {
    selected: capped.slice(0, config.lowConfidenceK),
    lowConfidence: true,
  };
}
