// DI token for the resolved plan-limit map, provided by `AppModule` as a
// hardcoded value (following the `MAX_UPLOAD_BYTES` token pattern). The
// entitlement guard and the usage endpoint read their ceilings from here so
// the numbers change in exactly one place, and integration tests can boot the
// app with tiny limits via the test-app factory's `planLimits` option.
export const PLAN_LIMITS = 'PLAN_LIMITS';

export type PlanSlug = 'free' | 'pro';

export interface PlanLimit {
  books: number;
  queries: number;
}

export type PlanLimits = Record<PlanSlug, PlanLimit>;

// Source of truth for the shipped limits (price and copy live in Clerk).
export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  free: { books: 2, queries: 20 },
  pro: { books: 50, queries: 1000 },
};
