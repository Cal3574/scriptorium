// DI token for the resolved plan-limit map, provided by the api app as a
// hardcoded value (the `MAX_UPLOAD_BYTES` token pattern). The entitlement guard
// and the usage endpoint read their ceilings from here so the numbers change in
// exactly one place, and integration tests inject tiny limits via the test-app
// factory's `planLimits` option.
export const PLAN_LIMITS = 'PLAN_LIMITS';

// The closed set of plan slugs. Source of truth for both the type and the
// runtime membership check in `resolvePlanSlug` - kept in step with the
// `PlanSlug` enum in `@scriptorium/contracts` (which this leaf package can't
// import).
export const PLAN_SLUGS = ['free', 'pro'] as const;
export type PlanSlug = (typeof PLAN_SLUGS)[number];

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
  return limits[resolvePlanSlug(plan)];
}

/**
 * The concrete plan slug a token maps to, applying the same unknown/absent ->
 * `free` fallback as {@link limitsForPlan}. Only ever returns a slug in
 * {@link PLAN_SLUGS}, so the usage endpoint never puts a raw, unrecognised
 * `pla` value on the wire even if `PLAN_LIMITS` later carries extra keys.
 */
export function resolvePlanSlug(plan: string | undefined): PlanSlug {
  return (PLAN_SLUGS as readonly string[]).includes(plan ?? '')
    ? (plan as PlanSlug)
    : 'free';
}
