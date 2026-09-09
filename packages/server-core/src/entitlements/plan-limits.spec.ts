import {
  DEFAULT_PLAN_LIMITS,
  limitsForPlan,
  resolvePlanSlug,
} from './plan-limits.js';

describe('resolvePlanSlug', () => {
  it('passes through a known slug', () => {
    expect(resolvePlanSlug('free')).toBe('free');
    expect(resolvePlanSlug('pro')).toBe('pro');
  });

  it('falls back to free for an absent, empty or unrecognised slug', () => {
    expect(resolvePlanSlug(undefined)).toBe('free');
    expect(resolvePlanSlug('')).toBe('free');
    expect(resolvePlanSlug('enterprise')).toBe('free');
    // A key that later appears in PLAN_LIMITS but not in the slug set must
    // still not reach the wire.
    expect(resolvePlanSlug('constructor')).toBe('free');
  });
});

describe('limitsForPlan', () => {
  it('returns the plan entry for a known slug', () => {
    expect(limitsForPlan(DEFAULT_PLAN_LIMITS, 'pro')).toEqual({
      books: 50,
      queries: 1000,
    });
  });

  it('returns the free entry for anything unrecognised', () => {
    expect(limitsForPlan(DEFAULT_PLAN_LIMITS, 'enterprise')).toEqual(
      DEFAULT_PLAN_LIMITS.free,
    );
    expect(limitsForPlan(DEFAULT_PLAN_LIMITS, undefined)).toEqual(
      DEFAULT_PLAN_LIMITS.free,
    );
  });
});
