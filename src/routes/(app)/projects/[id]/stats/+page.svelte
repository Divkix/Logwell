<script lang="ts">
import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
import { goto } from '$app/navigation';
import { navigating } from '$app/stores';
import BottomNav from '$lib/components/bottom-nav.svelte';
import LevelChart from '$lib/components/level-chart.svelte';
import StatsSkeleton from '$lib/components/stats-skeleton.svelte';
import TimeRangePicker, { type TimeRange } from '$lib/components/time-range-picker.svelte';
import TimeseriesChart from '$lib/components/timeseries-chart.svelte';
import type { TimeSeriesBucket } from '$lib/utils/timeseries';
import type { PageData } from './$types';

const { data }: { data: PageData } = $props();

// Local state (intentionally capture initial value - managed via URL navigation)
// svelte-ignore state_referenced_locally
let selectedRange = $state<TimeRange>((data.filters.range as TimeRange) || '24h');
let loading = $state(false);

// Timeseries chart state
let timeseriesData = $state<TimeSeriesBucket[]>([]);
let timeseriesLoading = $state(true);
let timeseriesError = $state<string | undefined>();

// Fetch timeseries data
async function fetchTimeseries(range: TimeRange) {
  timeseriesLoading = true;
  timeseriesError = undefined;
  try {
    const res = await fetch(`/api/projects/${data.project.id}/stats/timeseries?range=${range}`);
    if (!res.ok) {
      throw new Error('Failed to load timeseries data');
    }
    const json = await res.json();
    timeseriesData = json.buckets;
  } catch (e) {
    timeseriesError = e instanceof Error ? e.message : 'Unknown error';
    timeseriesData = [];
  } finally {
    timeseriesLoading = false;
  }
}

// Fetch timeseries on mount and when range changes
$effect(() => {
  fetchTimeseries(selectedRange);
});

// Show skeleton when navigating TO this page
const isNavigating = $derived($navigating?.to?.url.pathname.endsWith('/stats') ?? false);

function handleTimeRangeChange(range: TimeRange) {
  selectedRange = range;
  updateFilters();
}

async function updateFilters() {
  loading = true;

  const params = new URLSearchParams();
  params.set('range', selectedRange);

  const queryString = params.toString();
  const url = `/projects/${data.project.id}/stats?${queryString}`;

  await goto(url, { replaceState: true, noScroll: true });
  loading = false;
}

// Prepare chart data
const chartData = $derived({
  levelCounts: data.stats.levelCounts,
  levelPercentages: data.stats.levelPercentages,
});
</script>

{#if isNavigating}
  <StatsSkeleton />
{:else}
  <div class="space-y-4 sm:space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 sm:gap-4 min-w-0">
        <a
          href="/projects/{data.project.id}"
          class="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Back to logs"
        >
          <ArrowLeftIcon class="size-4" />
          <span class="sr-only">Logs</span>
        </a>
        <h1 class="text-lg sm:text-2xl font-bold truncate">{data.project.name}</h1>
      </div>
    </div>

    <!-- Stats Header -->
    <div class="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center justify-between gap-3 sm:gap-4">
      <div>
        <h2 class="text-base sm:text-lg font-semibold">Log Level Distribution</h2>
        <p class="text-xs sm:text-sm text-muted-foreground">
          Statistics for the selected time range
        </p>
      </div>

      <!-- Time range picker with horizontal scroll on mobile -->
      <div class="w-full sm:w-auto overflow-x-auto">
        <TimeRangePicker value={selectedRange} onchange={handleTimeRangeChange} disabled={loading} />
      </div>
    </div>

    <!-- Level Distribution Chart Section -->
    <div class="flex justify-center py-4 sm:py-8">
      {#if loading}
        <div class="flex flex-col gap-4">
          <div class="h-[160px] w-[160px] sm:h-[200px] sm:w-[200px] rounded-full bg-accent animate-pulse"></div>
          <div class="flex flex-col gap-2">
            {#each Array(5) as _}
              <div class="flex items-center gap-2">
                <div class="h-3 w-3 rounded-sm bg-accent animate-pulse"></div>
                <div class="h-4 w-24 bg-accent animate-pulse rounded-md"></div>
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <LevelChart data={chartData} />
      {/if}
    </div>

    <!-- Timeseries Chart Section -->
    <section class="mt-6 sm:mt-8">
      <h3 class="text-base sm:text-lg font-semibold mb-4">Logs Over Time</h3>
      <div class="h-[250px] sm:h-[300px]">
        <TimeseriesChart
          data={timeseriesData}
          range={selectedRange}
          loading={timeseriesLoading}
          error={timeseriesError}
        />
      </div>
    </section>

    <!-- Summary Stats -->
    <div class="text-center text-xs sm:text-sm text-muted-foreground">
      {#if data.stats.totalLogs > 0}
        <p>
          Viewing <span class="font-medium text-foreground">{data.stats.totalLogs.toLocaleString()}</span> logs
          from the last
          {#if selectedRange === '15m'}
            15 minutes
          {:else if selectedRange === '1h'}
            hour
          {:else if selectedRange === '24h'}
            24 hours
          {:else if selectedRange === '7d'}
            7 days
          {/if}
        </p>
      {:else}
        <p>No logs found in the selected time range</p>
      {/if}
    </div>
  </div>
{/if}

<!-- Mobile Bottom Navigation -->
<BottomNav projectId={data.project.id} />
