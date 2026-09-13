import { useAuth } from '@clerk/react';
import { useCallback, useRef } from 'react';
import { env } from '../env';
import { notifyPaymentRequired } from '../usage/payment-required-bus';

// Every API call goes through here so the bearer token is attached in exactly
// one place. `getToken()` returns the current Clerk session token (refreshed
// before expiry by the SDK); a `null` means signed out.
//
// `getToken` is read through a ref rather than closed over directly, so the
// callback this returns keeps one stable identity across renders - a caller
// that lists it in a `useEffect` dependency array never refetches just
// because a render happened, only when its own other dependencies change.
export function useApi() {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  return useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const token = await getTokenRef.current();
      const headers = new Headers(init.headers);
      if (token) headers.set('Authorization', `Bearer ${token}`);
      headers.set('Accept', 'application/json');
      const res = await fetch(`${env.apiUrl}${path}`, { ...init, headers });
      // A plan limit was hit somewhere - let the usage meter refresh itself.
      if (res.status === 402) notifyPaymentRequired();
      return res;
    },
    [],
  );
}
