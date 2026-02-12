<script lang="ts">
import type { IncidentListItem } from '$lib/shared/types';
import { cn } from '$lib/utils';
import { formatRelativeTime } from '$lib/utils/format';
import IncidentStatusBadge from './incident-status-badge.svelte';
import LevelBadge from './level-badge.svelte';

interface Props {
  incidents: IncidentListItem[];
  selectedIncidentId?: string | null;
  onSelect?: (incidentId: string) => void;
  loading?: boolean;
  class?: string;
}

const {
  incidents,
  selectedIncidentId = null,
  onSelect,
  loading = false,
  class: className,
}: Props = $props();

const SKELETON_COUNT = 8;

function selectIncident(id: string) {
  onSelect?.(id);
}
</script>

<div data-testid="incident-table" class={cn('w-full', className)}>
  <div class="space-y-2 sm:hidden">
    {#if loading}
      {#each Array(SKELETON_COUNT) as _, i (`mobile-skeleton-${i}`)}
        <div class="rounded-lg border p-3 animate-pulse">
          <div class="mb-2 h-4 w-2/3 rounded bg-accent"></div>
          <div class="mb-2 h-3 w-1/2 rounded bg-accent"></div>
          <div class="h-3 w-1/3 rounded bg-accent"></div>
        </div>
      {/each}
    {:else if incidents.length === 0}
      <div class="py-8 text-center text-muted-foreground">No incidents found for this filter</div>
    {:else}
      {#each incidents as item (item.id)}
        <button
          type="button"
          data-testid="incident-card"
          class={cn(
            'w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/40',
            selectedIncidentId === item.id && 'bg-primary/10 ring-1 ring-primary/40',
          )}
          onclick={() => selectIncident(item.id)}
        >
          <div class="mb-2 flex items-center justify-between gap-2">
            <IncidentStatusBadge status={item.status} />
            <LevelBadge level={item.highestLevel} />
          </div>
          <p class="line-clamp-2 text-sm font-medium">{item.title}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            {item.totalEvents.toLocaleString()} events • Last seen
            {formatRelativeTime(new Date(item.lastSeen))}
          </p>
        </button>
      {/each}
    {/if}
  </div>

  <table class="hidden w-full caption-bottom text-sm sm:table">
    <thead class="border-b">
      <tr class="border-b">
        <th class="h-10 px-4 text-left font-medium text-muted-foreground">Status</th>
        <th class="h-10 px-4 text-left font-medium text-muted-foreground">Title</th>
        <th class="h-10 px-4 text-left font-medium text-muted-foreground">Service/Source</th>
        <th class="h-10 px-4 text-left font-medium text-muted-foreground">Last Seen</th>
        <th class="h-10 px-4 text-left font-medium text-muted-foreground">Events</th>
      </tr>
    </thead>
    <tbody>
      {#if loading}
        {#each Array(SKELETON_COUNT) as _, i (`desktop-skeleton-${i}`)}
          <tr class="border-b">
            <td class="px-4 py-3"><div class="h-5 w-16 rounded bg-accent animate-pulse"></div></td>
            <td class="px-4 py-3"><div class="h-4 w-full max-w-sm rounded bg-accent animate-pulse"></div></td>
            <td class="px-4 py-3"><div class="h-4 w-full max-w-xs rounded bg-accent animate-pulse"></div></td>
            <td class="px-4 py-3"><div class="h-4 w-28 rounded bg-accent animate-pulse"></div></td>
            <td class="px-4 py-3"><div class="h-4 w-20 rounded bg-accent animate-pulse"></div></td>
          </tr>
        {/each}
      {:else if incidents.length === 0}
        <tr>
          <td colspan="5" class="h-32 text-center text-muted-foreground">
            No incidents found for this filter
          </td>
        </tr>
      {:else}
        {#each incidents as item (item.id)}
          <tr
            data-testid="incident-row"
            class={cn(
              'cursor-pointer border-b transition-colors hover:bg-muted/40',
              selectedIncidentId === item.id && 'bg-primary/10 ring-1 ring-primary/40',
            )}
            onclick={() => selectIncident(item.id)}
          >
            <td class="px-4 py-3">
              <div class="flex items-center gap-2">
                <IncidentStatusBadge status={item.status} />
                <LevelBadge level={item.highestLevel} />
              </div>
            </td>
            <td class="px-4 py-3">
              <p class="max-w-xl truncate font-medium" title={item.title}>{item.title}</p>
              <p class="text-xs text-muted-foreground font-mono">{item.fingerprint}</p>
            </td>
            <td class="px-4 py-3">
              <p class="text-sm">{item.serviceName ?? 'unknown service'}</p>
              <p class="text-xs font-mono text-muted-foreground">
                {item.sourceFile ?? 'unknown source'}{item.lineNumber ? `:${item.lineNumber}` : ''}
              </p>
            </td>
            <td class="px-4 py-3 text-sm text-muted-foreground">
              {formatRelativeTime(new Date(item.lastSeen))}
            </td>
            <td class="px-4 py-3 text-sm">{item.totalEvents.toLocaleString()}</td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>
</div>
