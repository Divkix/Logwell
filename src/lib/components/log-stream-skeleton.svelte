<script lang="ts">
import { Skeleton } from '$lib/components/ui/skeleton/index.js';

const SKELETON_ROW_COUNT = 10;
</script>

<div data-testid="log-stream-skeleton" class="space-y-6">
  <div data-testid="log-stream-skeleton-header" class="flex items-center justify-between">
    <div class="flex items-center gap-4">
      <Skeleton class="h-4 w-4" />
      <Skeleton class="h-8 w-40" />
    </div>
    <div class="flex items-center gap-2">
      <Skeleton class="h-9 w-20" />
      <Skeleton class="h-9 w-24" />
    </div>
  </div>

  <div data-testid="log-stream-skeleton-filters" class="flex flex-wrap items-center gap-4">
    <Skeleton class="h-6 w-16" />
    <Skeleton class="h-9 w-64 flex-1 max-w-sm" />
    <Skeleton class="h-9 w-24" />
    <Skeleton class="h-9 w-32" />
  </div>

  <div data-testid="log-stream-skeleton-table" class="w-full">
    <table class="w-full caption-bottom text-sm">
      <thead class="border-b">
        <tr class="border-b transition-colors">
          <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-32">
            <Skeleton class="h-4 w-12" />
          </th>
          <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-20">
            <Skeleton class="h-4 w-10" />
          </th>
          <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
            <Skeleton class="h-4 w-16" />
          </th>
        </tr>
      </thead>
      <tbody>
        {#each Array(SKELETON_ROW_COUNT) as _}
          <tr data-testid="log-stream-skeleton-row" class="border-b">
            <td class="px-4 py-2">
              <Skeleton class="h-4 w-24" />
            </td>
            <td class="px-4 py-2">
              <Skeleton class="h-5 w-14" />
            </td>
            <td class="px-4 py-2">
              <Skeleton class="h-4 w-full max-w-md" />
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <Skeleton class="h-4 w-48" />
</div>
