// The trailing-12-month activity series that backs the two `/activity` bar
// charts. Pure and clock-injectable so the boundary behaviour is unit-tested
// without a database; the repository hands in raw `YYYY-MM -> count` maps
// straight from two `group by date_trunc('month', ...)` reads.

export interface MonthlyActivityRow {
  /** `YYYY-MM` in UTC. */
  month: string;
  books: number;
  questions: number;
}

function utcMonthKey(year: number, monthIndex: number): string {
  // monthIndex is 0-based and may be negative or >11; Date.UTC normalises it.
  const d = new Date(Date.UTC(year, monthIndex, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The 12 UTC month keys ending with the month that contains `now`, oldest
 * first - e.g. `2026-09` yields `2025-10 .. 2026-09`.
 */
export function trailingTwelveMonths(now: Date = new Date()): string[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const keys: string[] = [];
  for (let offset = 11; offset >= 0; offset--) {
    keys.push(utcMonthKey(year, month - offset));
  }
  return keys;
}

/**
 * A zero-filled trailing-12-month series. `bookCounts` and `questionCounts`
 * are keyed by `YYYY-MM` (UTC); any key outside the window - older than the
 * first bar, or a future month from clock skew - is dropped rather than
 * clamped.
 */
export function buildMonthlyActivity(
  bookCounts: ReadonlyMap<string, number>,
  questionCounts: ReadonlyMap<string, number>,
  now: Date = new Date(),
): MonthlyActivityRow[] {
  return trailingTwelveMonths(now).map((month) => ({
    month,
    books: bookCounts.get(month) ?? 0,
    questions: questionCounts.get(month) ?? 0,
  }));
}
