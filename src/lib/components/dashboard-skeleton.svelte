<script lang="ts">
import { Card, CardContent, CardFooter, CardHeader } from '$lib/components/ui/card/index.js';
import { Skeleton } from '$lib/components/ui/skeleton/index.js';

const SKELETON_CARD_COUNT = 8;
</script>

<div data-testid="dashboard-skeleton" class="space-y-6">
  <div data-testid="dashboard-skeleton-header" class="flex items-center justify-between">
    <Skeleton class="h-8 w-32" data-testid="skeleton-title" />
    <Skeleton class="h-9 w-36" data-testid="skeleton-button" />
  </div>

  <div
    data-testid="dashboard-skeleton-grid"
    class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
  >
    {#each Array(SKELETON_CARD_COUNT) as _}
      <Card data-testid="project-card-skeleton" class="flex flex-col">
        <CardHeader>
          <Skeleton class="h-5 w-3/4" data-testid="skeleton-title" />
        </CardHeader>
        <CardContent class="flex-1" data-testid="skeleton-content">
          <Skeleton class="mb-2 h-4 w-20" />
          <Skeleton class="h-4 w-32" />
        </CardContent>
        <CardFooter>
          <Skeleton class="h-9 w-full" data-testid="skeleton-card-button" />
        </CardFooter>
      </Card>
    {/each}
  </div>
</div>
