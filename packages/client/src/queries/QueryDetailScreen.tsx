import { useParams } from 'react-router';

import { BackLink } from '@/components/back-link';
import { useChatWidget } from '@/chat-widget/chat-widget-context';
import { QueryDetail } from './QueryDetail';

// The `history/:queryId` route (#166): QueryDetail relocated out of
// QueryScreen since it has no code dependency on the ask form. "Ask again"
// opens the widget's Ask library tab with the question pre-filled (#167) -
// the old `/ask?q=` navigation went away with QueryScreen itself.
export function QueryDetailScreen() {
  const { queryId = '' } = useParams();
  const { prefillAsk } = useChatWidget();

  return (
    <section>
      <BackLink to="/history">Back to your questions</BackLink>
      <QueryDetail queryId={queryId} onAskAgain={prefillAsk} />
    </section>
  );
}
