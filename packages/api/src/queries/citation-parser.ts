// Citation enforcement is prompt + post-parse only (rag-query-spec 3.3): a
// pure parser records which excerpt markers the answer used. The answer is
// never rewritten or rejected - a dangling or malformed marker is a metric to
// watch, not a failure.

const MARKER_RE = /\[(\d{1,2})\]/g;

export interface CitationAudit {
  // Distinct in-range markers the answer cited, ascending.
  cited: number[];
  // Markers the answer wrote that fall outside 1..k (defensive; never observed
  // in the prototype).
  dropped: number[];
}

/**
 * Extract every `[n]` marker from the answer, partitioning them into markers
 * that index a real excerpt (`1..k`) and markers that do not. `k` is the
 * number of excerpts that were sent to the model.
 */
export function auditCitations(answer: string, k: number): CitationAudit {
  const cited = new Set<number>();
  const dropped = new Set<number>();
  for (const match of answer.matchAll(MARKER_RE)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= k) cited.add(n);
    else dropped.add(n);
  }
  const ascending = (a: number, b: number): number => a - b;
  return {
    cited: [...cited].sort(ascending),
    dropped: [...dropped].sort(ascending),
  };
}
