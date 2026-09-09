import { PricingTable } from '@clerk/react';

import { BackLink } from '@/components/back-link';
import { ScreenHeader } from '@/components/screen-header';
import { CLERK_APPEARANCE } from '../clerk-gate';

// The `/pricing` screen (subscription build spec #102, ticket #108). A
// signed-in-only route under the root layout, deliberately absent from the
// primary nav - it is reached only from the library usage meter, the inline
// limit-reached notice, and Clerk's own `<UserButton>` account menu.
//
// The page is a heading plus Clerk's `<PricingTable />` (with a back link to
// the library, matching every other non-root screen). Every plan name, price
// and feature bullet comes from Clerk (the plan `description` field) - the
// only client-authored text here is the "Plans" heading.
//
// `<PricingTable />` is not routed: clicking a plan opens Clerk's in-app
// checkout drawer (an overlay, no Stripe hosted redirect), themed with the
// app's `appearance` object. After checkout, `newSubscriptionRedirectUrl`
// returns the reader to `/library`, where the usage meter lives. The new
// `pla` claim arrives on the next session-token refresh (~60s worst case);
// no post-checkout return route papers over that staleness.
export function PricingScreen() {
  return (
    <section>
      <BackLink to="/library">Back to library</BackLink>
      <ScreenHeader title="Plans" />
      <PricingTable
        newSubscriptionRedirectUrl="/library"
        highlightedPlan="pro"
        checkoutProps={{ appearance: CLERK_APPEARANCE }}
      />
    </section>
  );
}
