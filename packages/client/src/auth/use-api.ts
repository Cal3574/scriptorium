import { useAuth } from '@clerk/react';
import { useCallback } from 'react';
import { env } from '../env';
import { notifyPaymentRequired } from '../usage/payment-required-bus';

// Every API call goes through here so the bearer token is attached in exactly
// one place. `getToken()` returns the current Clerk session token (refreshed
// before expiry by the SDK); a `null` means signed out.
export function useApi() {
  const { getToken } = useAuth();

  return useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const token = await getToken();
      const headers = new Headers(init.headers);
      if (token) headers.set('Authorization', `Bearer ${token}`);
      headers.set('Accept', 'application/json');
      const res = await fetch(`${env.apiUrl}${path}`, { ...init, headers });
      // A plan limit was hit somewhere - let the usage meter refresh itself.
      if (res.status === 402) notifyPaymentRequired();
      return res;
    },
    [getToken],
  );
}
