// "resets in 4d" - the distance from now to the question allowance's reset
// instant, rounded up to whole days so it only ever counts down. The reset is
// always in the future (first of next month, 00:00 UTC), so the result is at
// least "in 1d"; the last few hours of the month read as "in 1d", not "in 0d".
export function resetDistance(
  resetsAt: string,
  now: number = Date.now(),
): string {
  const ms = new Date(resetsAt).getTime() - now;
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  return `resets in ${days}d`;
}
