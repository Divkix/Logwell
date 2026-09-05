<script lang="ts">
import { Skeleton } from '$lib/components/ui/skeleton/index.js';

const LEGEND_ITEM_COUNT = 5;
</script>

<div data-testid="stats-skeleton" class="space-y-6">
  <div data-testid="stats-skeleton-header" class="flex items-center justify-between">
    <div class="flex items-center gap-4">
      <Skeleton class="h-4 w-4" />
      <Skeleton class="h-8 w-40" />
    </div>
  </div>

  <div data-testid="stats-skeleton-subheader" class="flex flex-wrap items-center justify-between gap-4">
    <div>
      <Skeleton class="mb-2 h-6 w-48" />
      <Skeleton class="h-4 w-64" />
    </div>
    <Skeleton class="h-9 w-24" />
  </div>

  <div data-testid="stats-skeleton-chart" class="flex justify-center py-8">
    <div class="flex flex-col gap-4">
      <Skeleton
        data-testid="skeleton-donut"
        class="h-[200px] w-[200px] rounded-full"
      />

      <div data-testid="stats-skeleton-legend" class="flex flex-col gap-2">
        {#each Array(LEGEND_ITEM_COUNT) as _}
          <div data-testid="skeleton-legend-item" class="flex items-center gap-2">
            <Skeleton data-testid="skeleton-legend-color" class="h-3 w-3 rounded-sm" />
            <Skeleton data-testid="skeleton-legend-text" class="h-4 w-24" />
          </div>
        {/each}
      </div>
    </div>
  </div>

  <div data-testid="stats-skeleton-summary" class="text-center">
    <Skeleton class="mx-auto h-4 w-48" />
  </div>
</div>
