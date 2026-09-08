import { BackLink } from '@/components/back-link';
import { EmptyState } from '@/components/empty-state';
import { ScreenHeader } from '@/components/screen-header';
import { SparklesIcon } from 'lucide-react';

// A placeholder for `/pricing` so the library usage meter's link lands
// somewhere inside the app shell rather than on the router's default 404. The
// real plan comparison, Clerk `<PricingTable />` and limit-reached gating land
// in #108, which replaces this file.
export function PricingScreen() {
  return (
    <section>
      <BackLink to="/library">Back to library</BackLink>
      <ScreenHeader title="Plans &amp; pricing" />
      <EmptyState
        icon={SparklesIcon}
        title="Pricing is on the way"
        body="Plan comparison and upgrades will live here shortly. For now, the Free plan covers 2 books and 20 questions a month."
      />
    </section>
  );
}
