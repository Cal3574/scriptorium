// DI token for the resolved plan-limit map, provided by the api app as a
// hardcoded value (the `MAX_UPLOAD_BYTES` token pattern). The entitlement guard
// and the usage endpoint read their ceilings from here so the numbers change in
// exactly one place, and integration tests inject tiny limits via the test-app
// factory's `planLimits` option.
export const PLAN_LIMITS = 'PLAN_LIMITS';

export type PlanSlug = 'free' | 'pro';

export interface PlanLimit {
  books: number;
  queries: number;
}

export type PlanLimits = Record<PlanSlug, PlanLimit>;

// Source of truth for the shipped limits (price and plan copy live in Clerk).
export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  free: { books: 2, queries: 20 },
  pro: { books: 50, queries: 1000 },
};

/**
 * The limit entry for a plan slug read off a session token. An unknown or
 * absent plan resolves to the `free` entry - a missing `pla` claim must never
 * grant paid limits.
 */
export function limitsForPlan(
  limits: PlanLimits,
  plan: string | undefined,
): PlanLimit {
  if (plan && Object.prototype.hasOwnProperty.call(limits, plan)) {
    return limits[plan as PlanSlug];
  }
  return limits.free;
}
