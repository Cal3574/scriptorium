// A minimal fixed-size worker pool. `items` are processed by `fn` with at most
// `limit` promises in flight at once; results come back in input order. Used by
// the embed stage (128-chunk batches, 2 in flight) and the chapterSummary
// stage (one chapter per task, 3 in flight).
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let firstError: unknown;
  let failed = false;

  // Runners never reject: the first error is captured and every runner then
  // drains cleanly, so an in-flight sibling can't surface an unhandled
  // rejection after `Promise.all` has already settled on the failure. The
  // captured error is rethrown once all runners have stopped.
  const runner = async (): Promise<void> => {
    while (cursor < items.length && !failed) {
      const index = cursor++;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  };

  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, runner));
  if (failed) throw firstError;
  return results;
}

// Slice a list into fixed-size batches, last one short.
export function batch<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
