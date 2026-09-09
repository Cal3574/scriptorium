// The query allowance runs on a UTC calendar month for every plan: it counts
// rows created since the first of the current month at 00:00 UTC, and resets
// on the first of the next month at 00:00 UTC. Both boundaries are derived
// here so the enforcement count and the usage endpoint's `resetsAt` agree.

/** First of the current UTC calendar month at 00:00:00.000 UTC. */
export function currentMonthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * First of the next UTC calendar month at 00:00:00.000 UTC - the instant the
 * question allowance resets. `Date.UTC` rolls a month index of 12 into January
 * of the next year, so December needs no special case.
 */
export function nextMonthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
