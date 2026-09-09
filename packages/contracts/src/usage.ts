import { z } from 'zod';
import { isoTimestamp } from './primitives.js';

// Where a reader stands against their plan limits, as returned by
// `GET /api/v1/me/usage`. Drives the library toolbar's usage meter. The
// counts are derived server-side from the reader's own rows; the limits come
// from the `PLAN_LIMITS` token that also feeds the entitlement guard.

// The two shipped plans. An unknown or absent `pla` claim resolves to `free`
// on the server, so this is never anything else on the wire.
export const PlanSlug = z.enum(['free', 'pro']);
export type PlanSlug = z.infer<typeof PlanSlug>;

// One lever's standing. `limit` is always a plain positive integer - there is
// no "unlimited" plan.
const Allowance = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});

export const UsageDto = z.object({
  plan: PlanSlug,
  books: Allowance,
  // The question allowance also carries its reset instant: the first of next
  // month at 00:00 UTC, as an absolute ISO timestamp computed server-side.
  queries: Allowance.extend({ resetsAt: isoTimestamp }),
});
export type UsageDto = z.infer<typeof UsageDto>;
