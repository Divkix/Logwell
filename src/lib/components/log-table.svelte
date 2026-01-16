<script lang="ts">
import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
import type { Log } from '$lib/server/db/schema';
import { cn } from '$lib/utils';
import EmptyStateQuickstart from './empty-state-quickstart.svelte';
import LogCard from './log-card.svelte';
import LogRow from './log-row.svelte';

interface Props {
  logs: Log[];
  loading?: boolean;
  hasFilters?: boolean;
  onLogClick?: (log: Log) => void;
  class?: string;
  newLogIds?: Set<string>;
  project?: { apiKey: string };
  appUrl?: string;
  selectedIndex?: number;
}

const {
  logs,
  loading = false,
  hasFilters,
  onLogClick,
  class: className,
  newLogIds,
  project,
  appUrl,
  selectedIndex = -1,
}: Props = $props();

// Show quick start empty state when no filters and project/appUrl provided
const showQuickstartEmptyState = $derived(!hasFilters && project && appUrl);

const SKELETON_ROW_COUNT = 8;

// Determine empty state message and test id based on hasFilters
const emptyStateMessage = $derived(hasFilters ? 'No logs match your filters' : 'No logs yet');
const emptyStateTestId = $derived(hasFilters ? 'log-table-no-results' : 'log-table-empty');

// Sorting state and logic
type SortField = 'timestamp' | 'level' | 'message';
type SortDirection = 'asc' | 'desc' | null;

let sortField = $state<SortField | null>(null);
let sortDirection = $state<SortDirection>(null);

const levelPriority: Record<string, number> = {
  fatal: 5,
  error: 4,
  warn: 3,
  info: 2,
  debug: 1,
};

function handleSort(field: SortField) {
  if (sortField === field) {
    if (sortDirection === 'asc') {
      sortDirection = 'desc';
    } else if (sortDirection === 'desc') {
      sortField = null;
      sortDirection = null;
    } else {
      sortDirection = 'asc';
    }
  } else {
    sortField = field;
    sortDirection = 'asc';
  }
}

function getAriaSort(field: SortField): 'ascending' | 'descending' | 'none' {
  if (sortField !== field) return 'none';
  if (sortDirection === 'asc') return 'ascending';
  if (sortDirection === 'desc') return 'descending';
  return 'none';
}

const sortedLogs = $derived.by(() => {
  if (!sortField || !sortDirection) return logs;

  return [...logs].sort((a, b) => {
    let comparison = 0;
    if (sortField === 'timestamp') {
      comparison = (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0);
    } else if (sortField === 'level') {
      comparison = (levelPriority[a.level] ?? 0) - (levelPriority[b.level] ?? 0);
    } else if (sortField === 'message') {
      comparison = a.message.localeCompare(b.message);
    }
    return sortDirection === 'desc' ? -comparison : comparison;
  });
});
</script>

<div data-testid="log-table" class={cn('w-full', className)}>
  <!-- Mobile: Card-based layout (< 640px) -->
  <div class="space-y-2 sm:hidden">
    {#if loading}
      {#each Array(SKELETON_ROW_COUNT) as _}
        <div data-testid="log-card-skeleton" class="p-3 border rounded-lg animate-pulse">
          <div class="flex items-center justify-between gap-2 mb-2">
            <div class="h-5 w-14 bg-accent rounded-md" role="presentation"></div>
            <div class="h-4 w-20 bg-accent rounded-md" role="presentation"></div>
          </div>
          <div class="h-4 w-full bg-accent rounded-md" role="presentation"></div>
          <div class="h-4 w-3/4 bg-accent rounded-md mt-1" role="presentation"></div>
        </div>
      {/each}
    {:else if sortedLogs.length === 0}
      {#if showQuickstartEmptyState && project && appUrl}
        <EmptyStateQuickstart apiKey={project.apiKey} baseUrl={appUrl} />
      {:else}
        <div data-testid={emptyStateTestId} class="text-center py-8 text-muted-foreground">
          {emptyStateMessage}
        </div>
      {/if}
    {:else}
      {#each sortedLogs as log, i (log.id)}
        <LogCard {log} onclick={onLogClick} isNew={newLogIds?.has(log.id)} isSelected={i === selectedIndex} />
      {/each}
    {/if}
  </div>

  <!-- Tablet/Desktop: Table layout (>= 640px) -->
  <table class="hidden sm:table w-full caption-bottom text-sm">
    <thead data-testid="log-table-header" class="border-b">
      <tr class="border-b transition-colors">
        <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-32" aria-sort={getAriaSort('timestamp')}>
          <button
            type="button"
            class="flex items-center gap-1 hover:text-foreground transition-colors"
            aria-label="Sort by Time"
            onclick={() => handleSort('timestamp')}
          >
            Time
            {#if sortField === 'timestamp'}
              {#if sortDirection === 'asc'}
                <ArrowUpIcon class="h-4 w-4" />
              {:else}
                <ArrowDownIcon class="h-4 w-4" />
              {/if}
            {:else}
              <ArrowUpDownIcon class="h-4 w-4 opacity-50" />
            {/if}
          </button>
        </th>
        <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-20" aria-sort={getAriaSort('level')}>
          <button
            type="button"
            class="flex items-center gap-1 hover:text-foreground transition-colors"
            aria-label="Sort by Level"
            onclick={() => handleSort('level')}
          >
            Level
            {#if sortField === 'level'}
              {#if sortDirection === 'asc'}
                <ArrowUpIcon class="h-4 w-4" />
              {:else}
                <ArrowDownIcon class="h-4 w-4" />
              {/if}
            {:else}
              <ArrowUpDownIcon class="h-4 w-4 opacity-50" />
            {/if}
          </button>
        </th>
        <th class="h-10 px-4 text-left align-middle font-medium text-muted-foreground" aria-sort={getAriaSort('message')}>
          <button
            type="button"
            class="flex items-center gap-1 hover:text-foreground transition-colors"
            aria-label="Sort by Message"
            onclick={() => handleSort('message')}
          >
            Message
            {#if sortField === 'message'}
              {#if sortDirection === 'asc'}
                <ArrowUpIcon class="h-4 w-4" />
              {:else}
                <ArrowDownIcon class="h-4 w-4" />
              {/if}
            {:else}
              <ArrowUpDownIcon class="h-4 w-4 opacity-50" />
            {/if}
          </button>
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
      {:else if sortedLogs.length === 0}
        {#if showQuickstartEmptyState && project && appUrl}
          <tr>
            <td colspan="3">
              <EmptyStateQuickstart apiKey={project.apiKey} baseUrl={appUrl} />
            </td>
          </tr>
        {:else}
          <tr data-testid={emptyStateTestId} class="text-muted-foreground">
            <td colspan="3" class="h-32 text-center">
              {emptyStateMessage}
            </td>
          </tr>
        {/if}
      {:else}
        {#each sortedLogs as log, i (log.id)}
          <LogRow {log} onclick={onLogClick} isNew={newLogIds?.has(log.id)} isSelected={i === selectedIndex} />
        {/each}
      {/if}
    </tbody>
  </table>
</div>
