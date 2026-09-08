import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { UsageDto } from '@scriptorium/contracts';

import { useApi } from '../auth/use-api';
import { onPaymentRequired } from './payment-required-bus';

interface UsageContextValue {
  // `null` until the first successful fetch; the meter renders nothing while
  // null rather than guessing at limits.
  usage: UsageDto | null;
  // Re-read `GET /me/usage`. Safe to call on every trigger - failures are
  // swallowed and leave the last good value in place.
  refetch: () => Promise<void>;
}

const UsageContext = createContext<UsageContextValue | null>(null);

// Holds the reader's plan-limit standing for the whole signed-in shell. The
// value is refetched on four triggers: the library screen mounting, a
// successful upload, a completed query stream (all three call `refetch`
// directly), and any `402` from any API call (via the payment-required bus,
// wired here).
export function UsageProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [usage, setUsage] = useState<UsageDto | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await api('/api/v1/me/usage');
      if (!res.ok) return;
      setUsage(UsageDto.parse(await res.json()));
    } catch {
      // Network or parse failure: keep the last good meter, try again next
      // trigger. The meter is ambient - it never blocks a screen.
    }
  }, [api]);

  useEffect(() => onPaymentRequired(() => void refetch()), [refetch]);

  const value = useMemo(() => ({ usage, refetch }), [usage, refetch]);
  return (
    <UsageContext.Provider value={value}>{children}</UsageContext.Provider>
  );
}

export function useUsage(): UsageContextValue {
  const ctx = useContext(UsageContext);
  if (!ctx) {
    throw new Error('useUsage() must be used within <UsageProvider>');
  }
  return ctx;
}
