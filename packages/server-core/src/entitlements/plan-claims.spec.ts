import { parsePlanClaims } from './plan-claims.js';

describe('parsePlanClaims', () => {
  it('strips the scope prefix from a single `pla` claim', () => {
    expect(parsePlanClaims({ pla: 'u:pro' })).toEqual({
      plan: 'pro',
      features: [],
    });
  });

  it('splits a comma-separated scoped `fea` list', () => {
    expect(parsePlanClaims({ pla: 'u:free', fea: 'u:seats,u:export' })).toEqual({
      plan: 'free',
      features: ['seats', 'export'],
    });
  });

  it('yields an empty feature list - never undefined - when `fea` is absent', () => {
    const claims = parsePlanClaims({ pla: 'u:pro' });
    expect(claims.features).toEqual([]);
  });

  it('leaves an unrecognised plan slug as-is', () => {
    expect(parsePlanClaims({ pla: 'u:enterprise' }).plan).toBe('enterprise');
  });

  it('resolves a malformed or unscoped claim to no entitlement without throwing', () => {
    expect(() => parsePlanClaims({ pla: 'pro', fea: 'garbage' })).not.toThrow();
    expect(parsePlanClaims({ pla: 'pro', fea: 'garbage' })).toEqual({
      plan: undefined,
      features: [],
    });
  });

  it('treats a non-string or empty claim as no entitlement', () => {
    expect(parsePlanClaims({})).toEqual({ plan: undefined, features: [] });
    expect(parsePlanClaims({ pla: '', fea: 42 })).toEqual({
      plan: undefined,
      features: [],
    });
  });
});
