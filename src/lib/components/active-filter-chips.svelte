<script lang="ts">
import XIcon from '@lucide/svelte/icons/x';
import type { LogLevel } from '$lib/server/db/schema';
import { getLevelColor } from '$lib/utils/colors';

type TimeRange = '15m' | '1h' | '24h' | '7d';

interface Props {
  levels: LogLevel[];
  search: string;
  range: TimeRange;
  defaultRange?: TimeRange;
  onRemoveLevel?: (level: LogLevel) => void;
  onRemoveSearch?: () => void;
  onRemoveRange?: () => void;
}

const {
  levels,
  search,
  range,
  defaultRange = '1h',
  onRemoveLevel,
  onRemoveSearch,
  onRemoveRange,
}: Props = $props();

const hasActiveFilters = $derived(levels.length > 0 || search || range !== defaultRange);
</script>

{#if hasActiveFilters}
  <div data-testid="active-filter-chips" class="hidden sm:flex items-center gap-2 flex-wrap">
    {#each levels as level}
      <button
        data-testid="filter-chip-level-{level}"
        class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
        onclick={() => onRemoveLevel?.(level)}
        aria-label="Remove {level} filter"
      >
        <span
          class="size-2 rounded-full"
          style="background-color: {getLevelColor(level)}"
          aria-hidden="true"
        ></span>
        {level.toUpperCase()}
        <XIcon class="size-3" aria-hidden="true" />
      </button>
    {/each}

    {#if search}
      <button
        data-testid="filter-chip-search"
        class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors max-w-[150px]"
        onclick={() => onRemoveSearch?.()}
        aria-label="Remove search filter"
      >
        <span class="truncate">"{search}"</span>
        <XIcon class="size-3 shrink-0" aria-hidden="true" />
      </button>
    {/if}

    {#if range !== defaultRange}
      <button
        data-testid="filter-chip-range"
        class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-secondary text-secondary-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
        onclick={() => onRemoveRange?.()}
        aria-label="Remove time range filter"
      >
        {range}
        <XIcon class="size-3" aria-hidden="true" />
      </button>
    {/if}
  </div>
{/if}
