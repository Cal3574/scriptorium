import { useCallback, useEffect, useState } from 'react';
import { ActivityDto } from '@scriptorium/contracts';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ScreenHeader } from '@/components/screen-header';
import { useApi } from '../auth/use-api';
import { problemMessage } from '../books/problem';
import { ActivityBarChart } from './activity-bar-chart';
import { StatTiles } from './stat-tiles';
import { TopBooks } from './top-books';

// The `/activity` dashboard: one `GET /me/activity` fetch on mount, then four
// headline tiles, the two trailing-12-month bar charts side by side, and the
// most-asked-books list. Read-only and ungated - a reader at their ceiling
// still sees where they stand.
export function ActivityScreen() {
  const api = useApi();
  const [activity, setActivity] = useState<ActivityDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api('/api/v1/me/activity');
    if (!res.ok) {
      throw new Error(
        (await problemMessage(res)) ?? `activity failed: ${res.status}`,
      );
    }
    setActivity(ActivityDto.parse(await res.json()));
  }, [api]);

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [load]);

  return (
    <section>
      <ScreenHeader title="Activity" />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Couldn&apos;t load your activity</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!activity ? (
        <ActivitySkeleton />
      ) : (
        <div className="flex flex-col gap-6">
          <StatTiles activity={activity} />

          <div className="grid gap-4 md:grid-cols-2">
            <ActivityBarChart
              title="Books per month"
              data={activity.monthly}
              metric="books"
              unitLabel="Books"
            />
            <ActivityBarChart
              title="Questions per month"
              data={activity.monthly}
              metric="questions"
              unitLabel="Questions"
            />
          </div>

          <TopBooks books={activity.topBooks} />
        </div>
      )}
    </section>
  );
}

function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading your activity</span>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[86px] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-[236px] rounded-lg" />
        <Skeleton className="h-[236px] rounded-lg" />
      </div>
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}
