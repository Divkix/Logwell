<script lang="ts">
import { browser } from '$app/environment';
import { cn } from '$lib/utils';
import type { TimeSeriesBucket } from '$lib/utils/timeseries';
import type { TimeRange } from './time-range-picker.svelte';

// Chart colors - using a blue that works in both light and dark modes
// CSS variables don't work in SVG/D3 context, so we use actual values
const CHART_COLOR = 'hsl(210, 100%, 50%)'; // Blue (same as info level)

interface Props {
  data: TimeSeriesBucket[];
  range: TimeRange;
  loading?: boolean;
  error?: string;
  class?: string;
}

let { data, range, loading = false, error, class: className }: Props = $props();

// Transform data for chart
const chartData = $derived(
  data.map((d) => ({
    date: new Date(d.timestamp),
    count: d.count,
  })),
);

// Determine if we should show the chart
const showChart = $derived(!loading && !error && data.length > 0);
const showEmpty = $derived(!loading && !error && data.length === 0);

// Format axis label based on range
function formatAxisLabel(date: Date): string {
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');

  if (range === '7d') {
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  }

  return `${hours}:${minutes}`;
}

// Format tooltip date
function formatTooltipDate(date: Date): string {
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}
</script>

<div
  data-testid="timeseries-chart"
  class={cn('w-full h-full', className)}
  aria-label="Time series chart showing log volume over time"
  role="figure"
>
  {#if loading}
    <!-- Skeleton state -->
    <div data-testid="timeseries-skeleton" class="w-full h-full animate-pulse">
      <div class="w-full h-full bg-muted rounded-lg"></div>
    </div>
  {:else if error}
    <!-- Error state -->
    <div
      data-testid="timeseries-error"
      class="w-full h-full flex items-center justify-center text-destructive"
    >
      <p>{error}</p>
    </div>
  {:else if showEmpty}
    <!-- Empty state -->
    <div
      data-testid="timeseries-empty"
      class="w-full h-full flex items-center justify-center text-muted-foreground"
    >
      <p>No data available for this time range</p>
    </div>
  {:else if showChart && browser}
    <!-- Chart (only render in browser) -->
    {#await import('layerchart') then { Chart, Svg, Area, Axis, Tooltip }}
      {#await import('d3-scale') then { scaleTime, scaleLinear }}
        <div data-testid="timeseries-chart-rendered" class="w-full h-full">
          <Chart
            data={chartData}
            x="date"
            xScale={scaleTime()}
            y="count"
            yScale={scaleLinear()}
            yNice={true}
            padding={{ top: 20, right: 20, bottom: 40, left: 50 }}
            tooltip={{ mode: 'band' }}
          >
            <Svg>
              <Axis placement="bottom" format={formatAxisLabel} />
              <Axis placement="left" format={(d) => d.toLocaleString()} />
              <Area
                fill={CHART_COLOR}
                fillOpacity={0.2}
                line={{ stroke: CHART_COLOR, strokeWidth: 2 }}
              />
            </Svg>
            <Tooltip.Root>
              {#snippet children({ data }: { data: { date: Date; count: number } })}
                                        <div
                  class="bg-popover text-popover-foreground p-2 rounded shadow-lg border text-sm"
                >
                  <div class="font-medium">{formatTooltipDate(data.date)}</div>
                  <div>{data.count.toLocaleString()} logs</div>
                </div>
                                                    {/snippet}
                                    </Tooltip.Root>
          </Chart>
        </div>
      {/await}
    {/await}
  {/if}
</div>
