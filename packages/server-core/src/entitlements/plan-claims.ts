// `@clerk/shared` is a direct dependency pinned in lockstep with
// `@clerk/backend` (#96). `splitByScope` is the same helper `@clerk/backend`
// uses internally to parse the `pla` / `fea` session-token scopes; the
// `/authorization` subpath resolves via the package's wildcard export. This
// module is the owned wrapper around it - `plan-claims.spec.ts` pins the
// behaviour, so a rename in a future Clerk bump fails in CI, not at runtime.
import { splitByScope } from '@clerk/shared/authorization';

// The plan and features a verified session token carries, with the `u:` / `o:`
// scope prefix stripped. `features` is always a list - an absent `fea` claim
// yields `[]`, never `undefined`.
export interface PlanClaims {
  plan?: string;
  features: string[];
}

/**
 * Parses the `pla` / `fea` session-token claims. `pla` is a single scoped
 * string (`"u:pro"` -> `"pro"`); `fea` is a comma-separated scoped list
 * (`"u:seats,u:export"` -> `["seats", "export"]`). An unrecognised plan slug is
 * left as-is for the guard to fall back on.
 *
 * Clerk's `splitByScope` throws on a value with no scope prefix; a malformed or
 * unscoped claim resolves to no entitlement rather than propagating - a broken
 * or missing claim must never be a free upgrade.
 */
export function parsePlanClaims(payload: {
  pla?: unknown;
  fea?: unknown;
}): PlanClaims {
  const { user: planUser, org: planOrg } = scopedValues(payload.pla);
  const { user: featureUser, org: featureOrg } = scopedValues(payload.fea);
  return {
    plan: planUser[0] ?? planOrg[0],
    features: [...featureUser, ...featureOrg],
  };
}

function scopedValues(claim: unknown): { org: string[]; user: string[] } {
  if (typeof claim !== 'string' || claim.length === 0) {
    return { org: [], user: [] };
  }
  try {
    return splitByScope(claim);
  } catch {
    return { org: [], user: [] };
  }
}
