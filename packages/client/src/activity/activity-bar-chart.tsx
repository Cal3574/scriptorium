import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { ActivityMonthDto } from '@scriptorium/contracts';

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatMonthLabel } from './format-month';

// One of the two trailing-12-month bar charts on the Activity screen. Single
// series, its own y-axis (books and questions live on wildly different
// scales), Recharts through the shadcn chart wrapper so the fill and tooltip
// pick up the `--chart-*` / surface tokens in both themes.
export function ActivityBarChart({
  title,
  data,
  metric,
  unitLabel,
}: {
  title: string;
  data: ActivityMonthDto[];
  metric: 'books' | 'questions';
  unitLabel: string;
}) {
  const headingId = useId();
  const total = data.reduce((sum, m) => sum + m[metric], 0);

  const config: ChartConfig = {
    [metric]: { label: unitLabel, color: 'var(--chart-1)' },
  };

  return (
    <figure
      className="border-border bg-card m-0 flex flex-col gap-3 rounded-lg border p-4"
      aria-labelledby={headingId}
    >
      <figcaption
        id={headingId}
        className="text-foreground font-serif text-sm font-semibold"
      >
        {title}
      </figcaption>

      {total === 0 ? (
        <p className="text-muted-foreground flex h-[180px] items-center justify-center text-center text-sm">
          No {unitLabel.toLowerCase()} in the last 12 months
        </p>
      ) : (
        <ChartContainer config={config} className="h-[180px] w-full">
          <BarChart data={data} margin={{ left: -16, right: 8, top: 4 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={formatMonthLabel}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={40}
              allowDecimals={false}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatMonthLabel(String(value))}
                />
              }
            />
            <Bar
              dataKey={metric}
              fill={`var(--color-${metric})`}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ChartContainer>
      )}
    </figure>
  );
}
