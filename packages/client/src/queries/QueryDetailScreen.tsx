import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';

import { BackLink } from '@/components/back-link';
import { askAgainPath } from './ask-again';
import { QueryDetail } from './QueryDetail';

// The `history/:queryId` route (#166): QueryDetail relocated out of
// QueryScreen since it has no code dependency on the ask form. "Ask again"
// still navigates to `/ask?q=` to re-run the question as a fresh
// `POST /queries` - unchanged until the ask route itself is cut over (#167).
export function QueryDetailScreen() {
  const { queryId = '' } = useParams();
  const navigate = useNavigate();

  const askAgain = useCallback(
    (prefill: string) => {
      navigate(askAgainPath(prefill));
    },
    [navigate],
  );

  return (
    <section>
      <BackLink to="/history">Back to your questions</BackLink>
      <QueryDetail queryId={queryId} onAskAgain={askAgain} />
    </section>
  );
}
