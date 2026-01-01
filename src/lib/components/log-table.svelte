<script lang="ts">
import type { Log } from '$lib/server/db/schema';
import { cn } from '$lib/utils';
import LogRow from './log-row.svelte';

interface Props {
  logs: Log[];
  loading?: boolean;
  onLogClick?: (log: Log) => void;
  class?: string;
}

const { logs, loading = false, onLogClick, class: className }: Props = $props();

const SKELETON_ROW_COUNT = 8;
</script>

<div data-testid="log-table" class={cn('w-full', className)}>
  <table class="w-full caption-bottom text-sm">
    <thead data-testid="log-table-header" class="border-b">
      <tr class="border-b transition-colors">
        <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-32">
          Time
        </th>
        <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-20">
          Level
        </th>
        <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
          Message
        </th>
      </tr>
    </thead>
    <tbody>
      {#if loading}
        {#each Array(SKELETON_ROW_COUNT) as _}
          <tr data-testid="log-table-skeleton-row" class="border-b">
            <td class="px-4 py-2">
              <div class="h-4 w-24 bg-accent animate-pulse rounded-md" role="presentation"></div>
            </td>
            <td class="px-4 py-2">
              <div class="h-5 w-14 bg-accent animate-pulse rounded-md" role="presentation"></div>
            </td>
            <td class="px-4 py-2">
              <div class="h-4 w-full max-w-md bg-accent animate-pulse rounded-md" role="presentation"></div>
            </td>
          </tr>
        {/each}
      {:else if logs.length === 0}
        <tr data-testid="log-table-empty" class="text-muted-foreground">
          <td colspan="3" class="h-32 text-center">
            No logs yet
          </td>
        </tr>
      {:else}
        {#each logs as log (log.id)}
          <LogRow {log} onclick={onLogClick} />
        {/each}
      {/if}
    </tbody>
  </table>
</div>
