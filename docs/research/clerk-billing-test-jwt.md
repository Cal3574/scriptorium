# Injecting plan claims into integration-test JWTs (research)

Research ticket: [Cal3574/scriptorium#99](https://github.com/Cal3574/scriptorium/issues/99).
Map: #93.
Scope: what both candidate guards need in order to read Clerk plan/feature entitlements off a hand-minted RS256 token in the API integration tests.
This is investigation only.
It does not decide `authenticateRequest()` vs parse-claims (that is decision ticket #96); it surfaces the facts each option needs.

Prior research: `docs/research/clerk-billing-stack.md` (ticket #94, branch `research/clerk-billing-stack`).
Key carried-over facts: Clerk entitlements ride in the session-token claims `pla` (single plan string, e.g. `"u:pro"`) and `fea` (comma list, e.g. `"u:export,u:analytics"`).
`has()` is networkless and derived from those claims, but only on the auth object from `@clerk/backend`'s `authenticateRequest()` / `getAuth()`, not on the bare `verifyToken()` payload the repo uses today via `packages/server-core/src/auth/token-verifier.ts`.
`pla` / `fea` cannot be set through Clerk JWT templates, so the integration tests must write them into the token payload directly.

All claims below are checked against the installed source, not GitHub `main`:
`@clerk/backend@3.16.13` (`node_modules/@clerk/backend/dist/`, bundled as `chunk-UHYAW5J6.mjs` and `chunk-QOX5XVDR.mjs`) and `@clerk/shared@4.30.2` (`dist/authorization.mjs`, `dist/jwtPayloadParser.mjs`).
Research performed 2026-09-07.

## Repo starting point

`packages/api/src/test-support/rsa-jwt.ts` mints its own RSA keypair once per suite, hands the SPKI public key to the app as `CLERK_JWT_KEY`, and signs short-lived RS256 tokens with `node:crypto`.
Today `authHeaderFor(user)` emits exactly three claims on top of `iat` / `nbf` / `exp`: `sub`, `email`, `azp`.

`packages/server-core/src/auth/token-verifier.ts` verifies with `@clerk/backend`'s `verifyToken(token, { jwtKey, authorizedParties })` and narrows the payload to `{ sub, email }` behind the abstract `TokenVerifier` seam.
There is no `has()` and no `pla` / `fea` handling anywhere in the app.

## TL;DR

| Question | Answer |
| --- | --- |
| Does `authenticateRequest()` verify a hand-minted RS256 header token the same networkless way as `verifyToken()`? | Yes. Its header-token branch calls the identical `verifyToken(token, ctx)`. With `jwtKey` set it loads the key from the PEM with zero network. |
| Extra inputs `authenticateRequest()` needs vs `verifyToken()`? | A non-empty `secretKey` string (any value passes the assertion), and a `Request`-shaped object with an `Authorization: Bearer` header and a URL. No `publishableKey`, no `apiClient` on the header path. |
| Does `toAuth().has({ plan: 'pro' })` / `has({ feature: 'analytics' })` resolve offline from `pla` / `fea`? | Yes, fully synchronous, no fetch. |
| Standalone `createCheckAuthorization` from `@clerk/shared` usable if the guard keeps `verifyToken()`? | Yes, exported from `@clerk/shared/authorization`. `checkBillingAuthorization` / `checkForFeatureOrPlan` are not exported. `@clerk/shared` is a transitive dep only, so direct use means adding it to `package.json` or vendoring ~15 lines. |
| Extra token claims required for a "signed-in" auth object beyond what the tests already mint? | None for `has()`. `sub` is the only load-bearing addition-free claim (it becomes `userId`, which `createCheckAuthorization` requires). `sid`, `sts`, `v` are not required; adding `sts: "active"` and `v: 2` is realistic and safe. |
| Any network call on a path the tests would hit? | No, provided `jwtKey` is passed and `getToken({ template })` is never called. Handshake and token-refresh are cookie-path only; JWKS fetch only happens when `jwtKey` is absent. |

## 1. What `authenticateRequest()` requires to succeed networklessly

`authenticateRequest(request, options)` (`chunk-UHYAW5J6.mjs` ~line 7122):

1. `createAuthenticateContext(createClerkRequest(request), options)`.
   `createClerkRequest` needs a `Request` (or a `{ url, headers }` shape); it reads the `Authorization` header into `tokenInHeader` and parses the URL.
   `createAuthenticateContext` only computes a cookie suffix `if (options.publishableKey)` via `getCookieSuffix` (SubtleCrypto hashing, no network), so `publishableKey` is optional.
2. `assertValidSecretKey(authenticateContext.secretKey)` runs for any non-M2M token.
   Its whole body is `if (!val || typeof val !== "string") throw`.
   So `secretKey: "sk_test_anything"` satisfies it. `verifyToken()` does not require this, so it is the one genuinely new option.
3. A `HandshakeService` and `OrganizationMatcher` are constructed but only used on the cookie path.

Because `tokenInHeader` is set, the request routes to `authenticateRequestWithTokenInHeader()` (~line 7325):

```js
if (isMachineJwt(tokenInHeader) || hasNonSessionJwtCategory(tokenInHeader)) { /* signed out */ }
const { data, errors } = await verifyToken(tokenInHeader, authenticateContext);
if (errors) throw errors[0];
return signedIn({ tokenType: SessionToken, authenticateContext, sessionClaims: data, headers: new Headers(), token: tokenInHeader });
```

`isMachineJwt` / `hasNonSessionJwtCategory` inspect a `cat` header claim and token prefixes.
The test tokens have header `{ alg: "RS256", typ: "JWT" }` only and `sub` like `user_xxx`, so neither matches.

`verifyToken(token, options)` (`chunk-UHYAW5J6.mjs` ~line 6558):

```js
if (options.jwtKey) {
  key = loadClerkJwkFromPem({ kid, pem: options.jwtKey });   // no network
} else if (options.secretKey) {
  key = await loadClerkJWKFromRemote({ ...options, kid });   // JWKS fetch
} else { /* JWKFailedToResolve */ }
return await verifyJwt(token, { ...options, key });
```

`loadClerkJwkFromPem` (~line 1696) ignores `kid` entirely (it just labels the JWK `local-${kid}`), strips the SPKI PEM header/trailer and the fixed RSA DER prefix/suffix, and returns `{ kty: "RSA", alg: "RS256", n: <modulus>, e: "AQAB" }`.
This is exactly the path `ClerkTokenVerifier` already relies on, and it works for the 2048-bit keypair the suite generates.

So: `authenticateRequest()` verifies a hand-minted RS256 header token through the same `verifyToken` -> `loadClerkJwkFromPem` -> `verifyJwt` path as the repo uses today.
The only additions are the dummy `secretKey` string and wrapping the token in a `Request`.

`verifyJwt` (`chunk-QOX5XVDR.mjs` ~line 354) asserts, in order: header `typ` and `alg`; RSA signature against the JWK; then `assertSubClaim(sub)` (must be a string), `assertAudienceClaim(aud, audience)` (only enforced when an `audience` option is passed), `assertAuthorizedPartiesClaim(azp, authorizedParties)` (only when `authorizedParties` is non-empty; then `azp` must be in the list), `assertExpirationClaim(exp)`, `assertActivationClaim(nbf)`, `assertIssuedAtClaim(iat)`.
There is no `iss`, `sid`, `v`, or `sts` requirement.
The tokens already carry `sub`, `azp`, `iat`, `nbf`, `exp`, so adding `pla` / `fea` is purely additive.

## 2. `toAuth().has({ plan })` / `has({ feature })` offline trace

`signedIn(...)` returns an object whose `toAuth()` calls `signedInAuthObject(authenticateContext, token, sessionClaims)` (`chunk-UHYAW5J6.mjs` ~line 6090):

```js
const { actor, sessionId, sessionStatus, userId, orgId, orgRole, orgSlug, orgPermissions, factorVerificationAge } =
  __experimental_JWTPayloadToAuthObjectProperties(sessionClaims);
// ...
has: createCheckAuthorization({
  orgId, orgRole, orgPermissions, userId, factorVerificationAge,
  features: sessionClaims.fea || "",
  plans:    sessionClaims.pla || "",
}),
```

`toAuth({ treatPendingAsSignedOut = true })` additionally swaps to a signed-out object `if (authObject.sessionStatus === "pending")`.
`sessionStatus` comes from `claims.sts ?? null`; with no `sts` claim it is `null`, which is not `"pending"`, so the auth object stays signed-in.

`__experimental_JWTPayloadToAuthObjectProperties` (`@clerk/shared/dist/jwtPayloadParser.mjs`) switches on `claims.v`.
`case 2` reads the `o` object for org id/role/permissions and calls `splitByScope(claims.fea)`.
The `default` branch (no `v`, or `v !== 2`) reads legacy `claims.org_id` etc. and does not touch `fea`.
Either way `userId = claims.sub`, and neither branch affects how `pla` / `fea` feed `has()` (those are read straight off `sessionClaims` back in `signedInAuthObject`).

`createCheckAuthorization` (`@clerk/shared/dist/authorization.mjs`):

```js
const createCheckAuthorization = (options) => (params) => {
  if (!options.userId) return false;                       // userId is mandatory
  return combine([
    checkOrgAuthorization(params, options),
    checkBillingAuthorization(params, options),
    checkReverificationAuthorization(params, options),
  ]);
};
// combine = results.some(r => r === "pass") && results.every(r => r === "pass" || r === "skip")
```

`checkBillingAuthorization({ feature?, plan? }, { features, plans })`:

* Returns `"skip"` when neither `feature` nor `plan` is asked.
* For a `feature` ask: fails if `features` is not a non-empty string, else `checkForFeatureOrPlan(features, params.feature)`.
* For a `plan` ask: same against `plans`.

`checkForFeatureOrPlan(claim, featureOrPlan)`:

```js
const { org: orgFeatures, user: userFeatures } = splitByScope(claim);
const [rawScope, rawId] = featureOrPlan.split(":");
const hasExplicitScope = rawId !== void 0;
// if the ask has an explicit u:/o: scope, check only that bucket; else check both
return [...orgFeatures, ...userFeatures].includes(id);
```

`splitByScope(claim)` splits on `,`, then on the first `:` of each element:
`"o:"` -> org bucket, `"u:"` -> user bucket, `"ou"` / `"uo"` -> both.
An element with no colon throws `Invalid claim element (missing colon)`.
`checkBillingAuthorization` wraps the call in `try/catch` and turns any throw into `"fail"`, so a malformed `pla` / `fea` denies rather than crashes on this path.
(Note: the `v: 2` branch of `__experimental_JWTPayloadToAuthObjectProperties` also calls `splitByScope(claims.fea)` and that call is not wrapped, so a malformed `fea` combined with `v: 2` and an `o` object would throw. Keep the claim strings well-formed.)

Worked example, payload `pla: "u:pro"`, `fea: "u:analytics,u:export"`, `sub: "user_123"`:

* `has({ plan: 'pro' })` -> `splitByScope("u:pro")` -> `{ user: ["pro"] }` -> `["pro"].includes("pro")` -> `"pass"`; org and reverification checks `"skip"` -> `true`.
* `has({ feature: 'analytics' })` -> user bucket `["analytics","export"]` includes `"analytics"` -> `true`.
* `has({ plan: 'enterprise' })` -> not in bucket -> `"fail"` -> `false`.
* `has({ feature: 'u:analytics' })` also works (explicit scope, user bucket only).

No `await`, no `fetch`, no `apiClient` call anywhere in this trace.

## 3. Standalone `createCheckAuthorization` / `checkBillingAuthorization`

`@clerk/shared/dist/authorization.mjs` ends with:

```js
export { createCheckAuthorization, resolveAuthState, splitByScope, validateReverificationConfig };
```

So:

* `createCheckAuthorization` is exported and usable standalone.
* `splitByScope` is exported too (useful if you want to parse `pla` / `fea` yourself).
* `checkBillingAuthorization` and `checkForFeatureOrPlan` are **not** exported.
* `@clerk/backend` does not re-export any of these.

Import path: `@clerk/shared/authorization`.
`@clerk/shared`'s `package.json` has no explicit `./authorization` entry, but its `exports` includes a wildcard `"./*": { import: { types: "./dist/*.d.mts", default: "./dist/*.mjs" } }`, so `@clerk/shared/authorization` resolves to `dist/authorization.mjs`.

`createCheckAuthorization(options)` input:

```ts
{
  userId: string | null | undefined;        // REQUIRED truthy, else the checker always returns false
  orgId?; orgRole?; orgPermissions?;         // only needed for role/permission asks
  factorVerificationAge?: [number, number] | null;  // only for reverification asks
  features: string;                          // the raw `fea` claim string, e.g. "u:analytics,u:export"
  plans: string;                             // the raw `pla` claim string, e.g. "u:pro"
}
```

Returns `(params: { role?; permission?; feature?; plan?; reverification? }) => boolean`.

For the parse-claims guard, the minimal call after `verifyToken()` is:

```ts
const payload = await verifyToken(token, { jwtKey, authorizedParties });
const has = createCheckAuthorization({
  userId: payload.sub,
  features: (payload.fea as string) ?? "",
  plans: (payload.pla as string) ?? "",
});
has({ plan: "pro" });      // boolean
has({ feature: "analytics" });
```

Trade-off to note for #96: `@clerk/shared` is currently only a transitive dependency (under `@clerk/backend` and `@clerk/react`).
Importing it directly means adding it to `packages/server-core/package.json` and keeping its version in lockstep with `@clerk/backend`, or vendoring the ~15 lines of `splitByScope` + `checkForFeatureOrPlan` into the repo.

## 4. Recommended test-helper API

Extend `authHeaderFor` with an optional second argument.
Backward compatible: existing call sites pass no entitlements and get today's behaviour.

```ts
export interface TestEntitlements {
  /** Plan slug without scope prefix, e.g. "pro". Emitted as `pla: "u:<plan>"`. */
  plan?: string;
  /** Feature slugs without scope prefix. Emitted as `fea: "u:<f1>,u:<f2>"`. */
  features?: string[];
}

authHeaderFor(
  user: { clerkUserId: string; email: string },
  entitlements?: TestEntitlements,
): { Authorization: string };
```

Claim construction inside `signRs256`:

```ts
const claims: Record<string, unknown> = {
  sub: user.clerkUserId,
  email: user.email,
  azp: authorizedParty,
};
if (entitlements?.plan) {
  claims.pla = `u:${entitlements.plan}`;
}
if (entitlements?.features?.length) {
  claims.fea = entitlements.features.map((f) => `u:${f}`).join(",");
}
```

Rules that matter:

* **Scope prefix is mandatory.**
  `pla` / `fea` elements must be `"<scope>:<slug>"`.
  A bare `"pro"` throws `missing colon` inside `splitByScope` (caught -> `has()` returns `false`), so the helper must add `u:` (B2C / personal subscription) or `o:` (organization).
* `pla` is a single value, `fea` is a comma-joined list, no spaces needed.
* Omit the claims entirely when not asked.
  Clerk itself emits `pla: "u:free"` for the auto-created free plan; mirroring that as an explicit default (`entitlements?.plan ?? "free"`) is optional and only matters if a test asserts `has({ plan: 'free' })`.

Claims needed for the auth object to be "signed-in":

* `sub` (string) is the only strictly required one, and the tests already mint it.
  It becomes `userId`; `createCheckAuthorization` returns `false` for every check when `userId` is falsy.
* `sid`, `sts`, `v` are **not** required for `has()` to work.
  `sid` -> `sessionId` (only read if code calls `getToken`).
  `sts` -> `sessionStatus`; absent is treated as not-pending, so signed-in.
  `v` -> only changes org-claim parsing.
* Recommended for realism, not correctness: add `sts: "active"` and `v: 2` (real Clerk billing claims ride in v2 tokens).
  If you add `v: 2`, do **not** also add a malformed `fea`, because the v2 branch's `splitByScope(claims.fea)` call is unguarded.
  Adding `v: 2` without an `o` object is safe.

If the guard switches to `authenticateRequest()` (decision #96), the helper also needs to support building a `Request`, and the app needs a dummy `secretKey`.
A small addition to `TestAuthority` such as `requestFor(user, entitlements)` returning a `new Request("http://localhost/", { headers: authHeaderFor(...) })` keeps that detail in the test-support module.

## 5. Network calls and how to stay offline

On the header-token path that the integration tests exercise, there is **no** network call, provided:

1. **`jwtKey` is passed to the verifier / `authenticateRequest`.**
   With `jwtKey` set, `verifyToken` takes the `loadClerkJwkFromPem` branch.
   Without it, it falls through to `loadClerkJWKFromRemote`, which fetches the JWKS from Clerk's API.
   The repo already sets `CLERK_JWT_KEY` for the suite, so this holds.
2. **`getToken({ template })` is never called in a test.**
   `signedInAuthObject` builds a `getToken` whose fetcher calls `apiClient.sessions.getToken`.
   It is lazy; `has()`, `userId`, `sessionClaims` etc. never invoke it.
   Plain `getToken()` with no template returns the raw session token without a fetch, but `getToken({ template })` always hits the network.
3. Paths not reached from a header token: the handshake flow (`HandshakeService.resolveHandshake`, `verifyHandshakeToken`, `getHandshakePayload`) is cookie-path only; token refresh (`refreshSession`) needs a refresh-token cookie **and** `options.apiClient`; machine-token verification needs an M2M prefix or `cat` header.

To guarantee offline in tests: pass `jwtKey`, do not pass `apiClient`, send the token only in the `Authorization` header (never as a `__session` cookie), and never call `getToken` with a template.
An `afterEach` assertion that no `fetch` / `undici` call was made (or running with network disabled) would lock this in.

## Complications for injecting plan claims into the existing setup

1. **Minting is trivial; consuming is the open question.**
   Adding `pla` / `fea` to `rsa-jwt.ts` is a few additive lines.
   But nothing in the app reads them: `ClerkTokenVerifier` uses bare `verifyToken` and the `TokenVerifier` seam narrows to `{ sub, email }`.
   Either the guard moves to `authenticateRequest()` or it parses the claims; that is decision #96.
2. **The `TokenVerifier` seam shape does not fit `authenticateRequest()`.**
   `abstract verify(token: string): Promise<VerifiedToken>` takes a bare string.
   `authenticateRequest()` wants a `Request` plus a `secretKey`, and returns a `RequestState`, not a payload.
   Adopting it means widening the seam (e.g. `verify(req): Promise<{ sub; email; has }>`), which touches `ClerkAuthGuard` and its unit tests.
3. **`VerifiedToken` must widen either way.**
   To carry entitlements past the seam it needs `pla` / `fea` (or a `has` function) added, plus wherever the guard attaches identity to the request.
4. **`secretKey` becomes a required app input for the `authenticateRequest()` option.**
   Tests can pass any non-empty string, but the production config and env schema would gain a `CLERK_SECRET_KEY` that is currently absent (the repo runs networkless on `CLERK_JWT_KEY` alone).
5. **`@clerk/shared` is transitive-only.**
   The parse-claims option's tidiest form (`createCheckAuthorization`) needs it promoted to a direct dependency of `server-core`, version-pinned against `@clerk/backend`, or the logic vendored.
6. **Scope prefix and malformed-claim throw.**
   `pla` / `fea` must be written as `u:<slug>` / `o:<slug>`.
   A bare slug silently degrades to `has() === false` on the billing path, and throws outright if `v: 2` is also set.
   The helper must own the prefixing so individual tests pass plain slugs.
7. **Token version drift.**
   Real Clerk billing claims are v2-token claims.
   The test tokens are versionless today and pass verification fine, but a future `@clerk/backend` that assumes `v: 2` for billing parsing could diverge from the test fixtures.
   Setting `v: 2` in the helper hedges against this.

---

Doc: `docs/research/clerk-billing-test-jwt.md` on branch `research/clerk-billing-test-jwt` (branched off `main`, not pushed).
