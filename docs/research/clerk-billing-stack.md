# Clerk Billing on the Scriptorium stack (research)

Research ticket: [Cal3574/scriptorium#94](https://github.com/Cal3574/scriptorium/issues/94).
Map: #47.
Scope: can Clerk Billing carry a basic subscription model on Scriptorium's stack, and what are its load-bearing facts - Stripe/merchant model, plans vs features, server-side `has()`, client components, JWT claim shape, post-checkout redirect.
Stack facts: `packages/client` is a React 19 + Vite SPA on `@clerk/react` `^6.14.8` (Clerk "Core 3" - see [#49](https://github.com/Cal3574/scriptorium/issues/49) / `docs/research/clerk-theming.md`).
`packages/server-core` is a NestJS app that verifies session tokens with `@clerk/backend` `^3.16.13` (`verifyToken`), via `ClerkAuthGuard` / `ClerkTokenVerifier` (`packages/server-core/src/auth/`).
Note the ticket says "`@clerk/express`"; the repo actually uses `@clerk/backend` directly - this matters for `has()` (see section 3).
Research performed 2026-09-07. All claims cited inline to primary sources: Clerk docs (`clerk.com/docs`), the `clerk/javascript` and `clerk/skills` repos on GitHub, and Stripe docs.

## TL;DR against the charting assumptions

| Assumption | Verdict | Why |
| --- | --- | --- |
| "Clerk-managed Stripe exists and is low-setup" | **Half true.** No merchant-of-record option. Dev instances use a shared Clerk test gateway (zero setup). Production **requires your own Stripe account**. | [clerk.com/docs/nextjs/guides/billing/for-b2c](https://clerk.com/docs/nextjs/guides/billing/for-b2c), [clerk.com/docs/billing/overview](https://clerk.com/docs/billing/overview) |
| "`has()` works server-side from token claims, no network call" | **True - but not on our current code path.** `has()` is networkless, built from the `fea`/`pla` JWT claims. It only exists on the Auth object from `authenticateRequest()` / `getAuth()`, **not** on `verifyToken()` output, which is what `server-core` uses today. | [clerk/javascript `authObjects.ts`](https://github.com/clerk/javascript/blob/main/packages/backend/src/tokens/authObjects.ts), [clerk.com/docs/reference/backend/types/auth-object](https://clerk.com/docs/reference/backend/types/auth-object) |
| "Plan limits can live in our own config, not Clerk metadata" | **True and expected.** Clerk entitlements are booleans only (`has({ feature })` / `has({ plan })`). Numeric quotas are not modelled in Clerk; you map a feature slug to limits in your own config. | [clerk.com/docs/guides/billing/for-b2c](https://clerk.com/docs/guides/billing/for-b2c), [clerk.com/docs/guides/billing/custom-plans](https://clerk.com/docs/guides/billing/custom-plans) |
| "No webhooks needed for v1" | **True for access gating; not true if we persist subscription state.** Gating reads the session token, no webhook. Reacting to lifecycle (store status, dunning, downgrade cleanup, emails) needs billing webhooks. | [clerk.com/docs/guides/development/webhooks/billing](https://clerk.com/docs/guides/development/webhooks/billing), [clerk/skills billing SKILL.md](https://github.com/clerk/skills/blob/main/skills/features/clerk-billing/SKILL.md) |

## 1. Clerk-managed Stripe, fees, dev vs prod, test cards

**There is no "Clerk as merchant of record" option.** Clerk's billing FAQ answers the MoR question directly: "No, Clerk does not provide this service." ([clerk.com/docs/billing/overview](https://clerk.com/docs/billing/overview)).
Clerk Billing is a layer on top of Stripe as the payment processor: "Clerk Billing is a separate product from Stripe Billing. Plans and Subscriptions made in Clerk are not synced to Stripe." ([clerk.com/docs/billing/overview](https://clerk.com/docs/billing/overview)).

**Two payment-gateway choices, set on the Dashboard Billing settings page** ([clerk.com/docs/nextjs/guides/billing/for-b2c](https://clerk.com/docs/nextjs/guides/billing/for-b2c), [clerk.com/docs/expressjs/guides/billing/for-b2c](https://clerk.com/docs/expressjs/guides/billing/for-b2c)):

- **Clerk development gateway** - "a shared test Stripe account used for development instances". No Stripe signup, no keys. Development instances only.
- **Stripe account** - your own Stripe account, connected to Clerk. "A Stripe account created for a development instance cannot be used for production. For a production environment, you must create a separate Stripe account." An existing Stripe account works "as long as it isn't controlled by another platform" (i.e. not already under someone's Stripe Connect) ([clerk.com/docs/billing/overview](https://clerk.com/docs/billing/overview)).

So "low-setup" is accurate for a **dev instance** (nothing to configure) and inaccurate for **production** (full Stripe onboarding, separate account, KYC).

**Clerk's cut:** "0.7% per transaction, plus transaction fees which are paid directly to Stripe." ([clerk.com/docs/nextjs/guides/billing/for-b2c](https://clerk.com/docs/nextjs/guides/billing/for-b2c), [clerk.com/docs/expressjs/guides/billing/for-b2c](https://clerk.com/docs/expressjs/guides/billing/for-b2c)).
That is 0.7% to Clerk **on top of** standard Stripe processing fees (~2.9% + 30c in the US), and Clerk is not in the funds-flow as MoR - payouts land in your Stripe account.

**Dev instance vs production instance:**

| | Development instance | Production instance |
| --- | --- | --- |
| Gateway | Clerk development gateway (shared test Stripe) **or** a test-mode Stripe account | Your own live Stripe account (required) |
| Money | None - test mode only | Real charges, real payouts |
| Plans/Features | Configured per-instance in the Dashboard; **not** copied to production automatically | Reconfigured / promoted separately |
| Cards | Stripe test cards | Real cards |

**Test-mode card flow (dev instance):** subscribing through `<PricingTable />` opens Clerk's checkout drawer with a Stripe payment form wired to the test gateway. Use Stripe test cards - `4242 4242 4242 4242`, any future expiry, any CVC, any postal code for the success path; `4000 0000 0000 9995` for a decline, `4000 0025 0000 3155` for a 3DS challenge ([docs.stripe.com/testing](https://docs.stripe.com/testing), linked from [clerk.com/docs/billing/overview](https://clerk.com/docs/billing/overview)). No real charge is made; the subscription is created in Clerk and the `pla`/`fea` claims update on the user's next session-token refresh.

## 2. Plans vs Features model

**Where they are defined.** Dashboard -> Billing -> Plans ("Subscription plans" page, [dashboard.clerk.com/~/billing/plans](https://dashboard.clerk.com/~/billing/plans)). Plans are split across two tabs, and this split is load-bearing ([clerk/skills billing SKILL.md](https://github.com/clerk/skills/blob/main/skills/features/clerk-billing/SKILL.md), [clerk.com/docs/guides/billing/for-b2c](https://clerk.com/docs/guides/billing/for-b2c), [clerk.com/docs/guides/billing/for-b2b](https://clerk.com/docs/guides/billing/for-b2b)):

- **Plans for Users** - personal subscriptions. Rendered by `<PricingTable />` (default) and manageable in `<UserProfile />`.
- **Plans for Organizations** - B2B subscriptions. Rendered by `<PricingTable for="organization" />` and manageable in `<OrganizationProfile />`.

Enabling Billing auto-creates a `free_user` plan (and `free_org` if orgs are on) ([clerk/skills billing SKILL.md](https://github.com/clerk/skills/blob/main/skills/features/clerk-billing/SKILL.md)).
"Wrong tab is the #1 cause of an empty `<PricingTable />`" ([clerk/skills billing SKILL.md](https://github.com/clerk/skills/blob/main/skills/features/clerk-billing/SKILL.md)).

**How features attach to plans.** A Feature is created and attached to a Plan either while creating the Plan or afterwards from the Plan's page; "you can add any number of Features to a Plan" ([clerk.com/docs/nextjs/guides/billing/for-b2c](https://clerk.com/docs/nextjs/guides/billing/for-b2c)).
The **same feature slug can be attached to more than one plan** ([clerk/skills billing SKILL.md](https://github.com/clerk/skills/blob/main/skills/features/clerk-billing/SKILL.md)) - so `pro` and `enterprise` can both carry `feature:export`.
Both Plans and Features have a **"Publicly available"** toggle that controls whether they show up in Clerk's UI components ([clerk.com/docs/nextjs/guides/billing/for-b2c](https://clerk.com/docs/nextjs/guides/billing/for-b2c)).

**Slug / naming conventions.** Plans and Features each get a URL-safe slug. Docs examples use bare lowercase slugs: plans `free`, `bronze`, `silver`, `gold`, `pro`, `starter`, `enterprise`; features `premium_access`, `widgets`, `dashboard`, `impersonation`, `export`, `analytics` ([clerk.com/docs/guides/billing/for-b2c](https://clerk.com/docs/guides/billing/for-b2c), [clerk.com/docs/reference/components/control/show](https://clerk.com/docs/react/reference/components/control/show), [clerk.com/docs/guides/sessions/session-tokens](https://clerk.com/docs/guides/sessions/session-tokens)).
For **organization** plans, `has()` checks take an `org:` prefix, e.g. `has({ plan: 'org:team' })` ([clerk/skills billing SKILL.md](https://github.com/clerk/skills/blob/main/skills/features/clerk-billing/SKILL.md)).
Custom permissions are keyed `feature:action` and only resolve if that feature is in the active plan (see section 5).

**Checking a plan vs checking a feature.** Both are booleans via the same `has()` / `<Show>` API.

- `has({ plan: 'pro' })` - true iff the user's (or org's) active subscription **is** that plan. Tier-level gate.
- `has({ feature: 'export' })` - true iff the active plan **includes** that feature, regardless of which plan it is.

Clerk's own guidance: gate on **features**, not plans - "Gate by individual features, this is the preferred approach for specific capabilities... use `plan` checks only for tier-level gates" ([clerk/skills billing SKILL.md](https://github.com/clerk/skills/blob/main/skills/features/clerk-billing/SKILL.md)).
Feature gating means you can re-shuffle which plan carries a capability in the Dashboard without touching code.

## 3. Server-side `has()` (`@clerk/backend` / NestJS)

**API.** `has()` lives on the Auth object and has this signature ([clerk.com/docs/reference/backend/types/auth-object](https://clerk.com/docs/reference/backend/types/auth-object)):

```ts
function has(params: {
  role?: string;
  permission?: string;
  feature?: string;
  plan?: string;
  reverification?: ReverificationConfig;
}): boolean
```

Usage in an Express/Nest handler ([clerk.com/docs/expressjs/guides/billing/for-b2c](https://clerk.com/docs/expressjs/guides/billing/for-b2c)):

```ts
const { has } = getAuth(req)
const hasBronzePlan   = has({ plan: 'bronze' })
const hasPremiumAccess = has({ feature: 'premium_access' })
```

**Networkless?** Yes. `has()` is synchronous and does no fetch. In `clerk/javascript`, `signedInAuthObject()` builds the checker straight from the decoded session claims:

```ts
// packages/backend/src/tokens/authObjects.ts
has: createCheckAuthorization({
  orgId, orgRole, orgPermissions,
  userId,
  features: (sessionClaims.fea as string) || '',
  plans:    (sessionClaims.pla as string) || '',
  // ...
}),
```

`createCheckAuthorization` -> `checkBillingAuthorization` -> `checkForFeatureOrPlan` just parses the `fea` / `pla` strings (splitting on `,` and the `o:` / `u:` scope prefix) and does an `includes()` ([clerk/javascript `packages/shared/src/authorization.ts`](https://github.com/clerk/javascript/blob/main/packages/shared/src/authorization.ts)). No API call anywhere in that path. (Only `getToken({ template })` forces a network request - [clerk.com/docs/reference/backend/types/auth-object](https://clerk.com/docs/reference/backend/types/auth-object).)

**Gap in our repo.** `has()` is attached by `signedInAuthObject()`, which is produced by `authenticateRequest()` (and `getAuth()`, which wraps it). It is **not** on the return value of `@clerk/backend`'s `verifyToken()`, which returns the raw `JwtPayload` only. `packages/server-core/src/auth/token-verifier.ts` calls `verifyToken()` directly, so there is no `has()` in the app today. Two ways forward:

1. **Switch the guard to `authenticateRequest()`** (from `@clerk/backend`), keep the networkless config (`jwtKey` / `authorizedParties` are the same options), and read `has()` off the resulting auth object. Cleanest; gets roles/permissions too.
2. **Parse claims directly** - read `payload.pla` / `payload.fea` off the existing `verifyToken()` payload and do the scope-prefix split ourselves, or call `@clerk/shared`'s `createCheckAuthorization`. Smaller diff, but re-implements Clerk logic.

Either way the check stays offline and rides the session token we already verify.

**Staleness.** The claims only change when the session token is reminted (Clerk session tokens are short-lived, ~60s, and auto-refresh client-side). A user who just completed checkout may see the old entitlement for up to ~1 token lifetime. For a hard "must be live" check, call the Backend API (`getUser` / subscriptions) instead - but that is a network call and not needed for v1.

## 4. Client-side components

All from `@clerk/react` `^6.14.8` (Core 3). Core 3 **removed `<Protect>`** and folded it into `<Show>` ([clerk.com/docs/react/reference/components/control/show](https://clerk.com/docs/react/reference/components/control/show), and `docs/research/clerk-theming.md` on the Core 3 rename).

### `<Show>` (replaces `<Protect>` / `<SignedIn>` / `<SignedOut>`)

Props ([clerk.com/docs/react/reference/components/control/show](https://clerk.com/docs/react/reference/components/control/show)):

| Prop | Type | Notes |
| --- | --- | --- |
| `when` | `'signed-in' \| 'signed-out' \| { role } \| { permission } \| { feature } \| { plan } \| (has) => boolean` | The condition. Callback form gets `has` for `||` / `&&` logic. |
| `fallback` | `ReactNode` | Rendered when `when` fails. |
| `treatPendingAsSignedOut` | `boolean` (default `true`) | Pending sessions count as signed-out. |

```tsx
<Show when={{ plan: 'bronze' }} fallback={<p>Bronze subscribers only.</p>}>
  <h1>Exclusive Bronze Content</h1>
</Show>

<Show when={{ feature: 'premium_access' }} fallback="Premium Access required.">
  <PremiumPanel />
</Show>
```

Core 3 migration: `<Protect role="admin">` -> `<Show when={{ role: 'admin' }}>`; the old `condition` prop moves into `when`.
Security note from the docs: `<Show>` "only visually hides its children" - the markup is still in the bundle, so always back it with a server check ([clerk.com/docs/react/reference/components/control/show](https://clerk.com/docs/react/reference/components/control/show)).

### `has()` from `useAuth()`

```tsx
const { has } = useAuth()
has?.({ feature: 'analytics' })
has?.({ plan: 'pro' })
```

Same claim-derived, networkless check as the server ([clerk/skills billing SKILL.md](https://github.com/clerk/skills/blob/main/skills/features/clerk-billing/SKILL.md)).
`useAuth()` also exposes `has` as `undefined` until Clerk is loaded, hence the `?.`.

For richer client state there is `useSubscription()` (from `@clerk/react/experimental` at time of writing) returning `status`, `nextPayment.date`, etc. ([clerk/skills billing SKILL.md](https://github.com/clerk/skills/blob/main/skills/features/clerk-billing/SKILL.md)).

### `<PricingTable />`

Props ([clerk.com/docs/react/reference/components/billing/pricing-table](https://clerk.com/docs/react/reference/components/billing/pricing-table)):

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `for` | `'user' \| 'organization'` | `'user'` | Which plan tab to render. |
| `newSubscriptionRedirectUrl` | `string` | - | "The URL to navigate to after the user completes the checkout and selects the 'Continue' button." |
| `appearance` | `Appearance` | - | Theming, same shape as elsewhere (affects Clerk components only). |
| `checkoutProps` | `{ appearance }` | - | Passes an `appearance` through to the checkout drawer specifically. |
| `ctaPosition` | `'top' \| 'bottom'` | `'bottom'` | CTA button placement (needs default layout). |
| `collapseFeatures` | `boolean` | `false` | Collapse the feature list (needs default layout). |
| `highlightedPlan` | `string` (plan slug) | - | Adds a "Popular" badge to that plan card. |
| `fallback` | `JSX` | - | Shown while the component mounts. |

There is no path/routing prop - `<PricingTable />` is not a routed multi-screen component; the checkout is a drawer overlay, not a route ([clerk.com/blog/add-subscriptions-to-your-saas-with-clerk-billing](https://clerk.com/blog/add-subscriptions-to-your-saas-with-clerk-billing)).
Docs recommend giving it its own dedicated page ([clerk.com/docs/nextjs/guides/billing/for-b2c](https://clerk.com/docs/nextjs/guides/billing/for-b2c)).

### `<UserProfile />` billing tab

When Billing is enabled, `<UserProfile />` gains a **Billing tab** with the user's current subscription, plan switching (it can open the same checkout drawer), payment methods, and invoice history ([clerk.com/blog/add-subscriptions-to-your-saas-with-clerk-billing](https://clerk.com/blog/add-subscriptions-to-your-saas-with-clerk-billing), [clerk.com/newsletter/2025-05-30](https://clerk.com/newsletter/2025-05-30)).
Any **user** plan appears both in `<PricingTable />` and in the `<UserProfile />` billing tab ([clerk.com/blog/add-subscriptions-to-your-saas-with-clerk-billing](https://clerk.com/blog/add-subscriptions-to-your-saas-with-clerk-billing)).
It is also surfaced through `<UserButton />` -> "Manage account".

### Theming (cross-ref #49 / `docs/research/clerk-theming.md`)

`<PricingTable>`, `<Show>` output, `<UserProfile>` billing tab and the checkout drawer are all standard Clerk components and take the Core 3 `appearance` object (`theme` / `variables` / `elements` / `options`). Set it once on `<ClerkProvider appearance={...}>` and it flows to billing UI too; use `<PricingTable checkoutProps={{ appearance }}>` to style the drawer differently. Same `elements` slot-targeting approach as documented for `<SignIn>` in `docs/research/clerk-theming.md`.

## 5. Exact JWT / session-token claims for entitlements

Source: [clerk.com/docs/guides/sessions/session-tokens](https://clerk.com/docs/guides/sessions/session-tokens) (v2 token, the current default), cross-checked against [clerk/javascript `authObjects.ts`](https://github.com/clerk/javascript/blob/main/packages/backend/src/tokens/authObjects.ts).

| Claim | Meaning | Format | Example |
| --- | --- | --- | --- |
| `pla` | Active **plan** | `"<scope>:<planslug>"`, single value. Scope is `u` (user) or `o` (organization). | `"u:free"`, `"o:pro"` |
| `fea` | Enabled **features** | Comma-separated list of `"<scope>:<featureslug>"`. Scope `o`, `u`, or `ou`/`uo` (both). | `"o:dashboard,o:impersonation"`, `"u:premium_access,u:export"` |
| `o` | Active organization (only when in one) | Object: `{ id, slg, rol, per, fpm }` | see below |
| `o.fpm` | Feature-permission map (bitmask) | Comma-separated integers, one per feature in `fea` order; each int's bits, LSB first, flag which of that feature's permissions are granted | `"3,2"` |
| `v` | Token version | integer | `2` |
| `sid` / `sub` | Session / user id | string | `sess_123` / `user_123` |
| `sts` | Session status | string | `"active"`, `"pending"` |

`o` object shape ([clerk.com/docs/guides/sessions/session-tokens](https://clerk.com/docs/guides/sessions/session-tokens)):

```json
{
  "id": "org_123",
  "slg": "org-slug",
  "rol": "admin",
  "per": "read,manage",
  "fpm": "3,2"
}
```

Full default claim set (all non-overridable): `azp, exp, fva, iat, iss, jti, nbf, sid, sub, v, pla, fea, sts` ([clerk.com/docs/guides/sessions/session-tokens](https://clerk.com/docs/guides/sessions/session-tokens)).

**Cannot be faked via JWT templates.** "Session-tied claims like `sid`, `v`, `pla`, or `fea` cannot be included in custom JWTs" / "default claims ... cannot be overridden by templates" ([clerk.com/docs/guides/sessions/customize-session-tokens](https://clerk.com/docs/guides/sessions/customize-session-tokens), [clerk.com/docs/guides/sessions/session-tokens](https://clerk.com/docs/guides/sessions/session-tokens)).

**Permissions depend on plan.** A custom permission `feature:action` only lands in `fea`/`fpm` and only makes `has({ permission })` true if that feature is in the active plan ([clerk.com/docs/guides/sessions/customize-session-tokens](https://clerk.com/docs/guides/sessions/customize-session-tokens)).

**For integration tests (feeds the test-JWT-injection ticket):** mint a token whose payload includes `"pla": "u:pro"` and `"fea": "u:export,u:analytics"` (plus the standard `sub`, `sid`, `iat`, `exp`, `nbf`, `iss`, `azp`, `v: 2`), signed with a test RSA keypair whose public key you feed to `verifyToken({ jwtKey })` / `authenticateRequest`. `has({ plan: 'pro' })` and `has({ feature: 'export' })` then resolve offline against that payload. The existing `TokenVerifier` seam in `packages/server-core/src/auth/token-verifier.ts` already exists precisely so tests can bypass real Clerk tokens - extend the fake to carry `pla`/`fea` once the guard exposes `has()`.
Token size budget: after default claims the cookie has ~1.2KB for custom claims, 4KB cookie cap ([clerk.com/docs/guides/sessions/customize-session-tokens](https://clerk.com/docs/guides/sessions/customize-session-tokens)) - keep `fea` lists small.

## 6. Post-checkout return / redirect flow

1. User clicks a plan in `<PricingTable />` (or the `<UserProfile />` billing tab). A **checkout drawer** opens in-app - an overlay, not a route ([clerk.com/blog/add-subscriptions-to-your-saas-with-clerk-billing](https://clerk.com/blog/add-subscriptions-to-your-saas-with-clerk-billing)).
2. User enters payment details (Stripe form; test cards on a dev instance). On submit the subscription is created in Clerk.
3. The drawer shows a success state with a **"Continue" button**.
4. **Default:** clicking "Continue" just closes the drawer and leaves the user on the same page. The client Clerk state updates and `has()` / `<Show>` re-render as the session token refreshes (up to ~1 token lifetime).
5. **With `newSubscriptionRedirectUrl`:** "the URL to navigate to after the user completes the checkout and selects the 'Continue' button" - Clerk client-navigates there instead ([clerk.com/docs/react/reference/components/billing/pricing-table](https://clerk.com/docs/react/reference/components/billing/pricing-table)).
6. The lower-level `<CheckoutButton>` additionally exposes an `onSubscriptionComplete` callback and the same `newSubscriptionRedirectUrl` ([clerk.com/docs/react/reference/components/billing/checkout-button](https://clerk.com/docs/react/reference/components/billing/checkout-button)).

There is **no Stripe Checkout hosted-page redirect** and no `success_url` round-trip - the whole flow is in-app, so no "return handler" route is required. If you need server-side confirmation (e.g. unlock something in your DB the instant payment lands, before the token refreshes), that is what billing webhooks (`subscription.created`, `subscriptionItem.*`) are for ([clerk.com/docs/guides/development/webhooks/billing](https://clerk.com/docs/guides/development/webhooks/billing), [clerk/skills billing SKILL.md](https://github.com/clerk/skills/blob/main/skills/features/clerk-billing/SKILL.md)) - not needed for a read-time-gated v1.

## Verdict for a v1 subscription model on Scriptorium

Feasible and low-code, with these load-bearing facts:

- Dev: turn on Billing, use the Clerk development gateway, define user plans + feature slugs, drop `<PricingTable />` on a page. Zero Stripe setup.
- Prod: needs a real, separate Stripe account and eats 0.7% + Stripe fees. Clerk is not MoR - no VAT/sales-tax handling, that stays on us.
- Gate on **feature** slugs, not plan slugs. Keep numeric limits in our own config keyed by feature slug.
- Server-side: switch `ClerkAuthGuard` from `verifyToken()` to `authenticateRequest()` (or parse `pla`/`fea` ourselves) to get networkless `has()`.
- Tests: mint RSA-signed tokens with `pla` / `fea` claims; the `TokenVerifier` seam already supports this.
- Webhooks: skip for pure gating; add them when we start persisting subscription status or sending billing emails.
