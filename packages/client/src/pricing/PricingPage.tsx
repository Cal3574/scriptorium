import { PricingTable } from '@clerk/react';

import { ScreenHeader } from '@/components/screen-header';
import { CLERK_APPEARANCE } from '../clerk-gate';

// The `/pricing` screen (wayfinder map #93, ticket #98). Not in the primary
// nav - reached from the library usage meter's "Upgrade to Pro" link, the
// inline limit-reached notice, and Clerk's own `<UserButton>` menu.
//
// All plan copy (names, price, bullet lists) comes from Clerk - the plan
// `description` field per ticket #95, since v1 attaches no Clerk Features.
// The only client-authored text on the page is the heading.
//
// `<PricingTable />` is not a routed component: clicking a plan opens Clerk's
// in-app checkout drawer (an overlay, no Stripe hosted redirect). After the
// drawer's "Continue", `newSubscriptionRedirectUrl` lands the user back on
// the library, where the usage meter lives. The new `pla` claim arrives on
// the next session-token refresh (~60s worst case).
export function PricingPage() {
  return (
    <section>
      <ScreenHeader title="Plans" />
      <PricingTable
        newSubscriptionRedirectUrl="/library"
        highlightedPlan="pro"
        checkoutProps={{ appearance: CLERK_APPEARANCE }}
      />
    </section>
  );
}

export default PricingPage;
