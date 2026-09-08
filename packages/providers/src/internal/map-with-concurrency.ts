// A minimal fixed-size worker pool, mirroring the worker package's own
// `mapWithConcurrency` (kept here so `@scriptorium/providers` stays free of a
// dependency on the app layers). `items` are processed by `fn` with at most
// `limit` promises in flight; results come back in input order. The first
// error is captured, every runner then drains cleanly, and the error is
// rethrown once all runners have stopped - so an in-flight sibling cannot
// surface an unhandled rejection after the pool has settled on a failure.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let firstError: unknown;
  let failed = false;

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
