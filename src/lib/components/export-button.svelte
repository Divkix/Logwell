<script lang="ts">
import DownloadIcon from '@lucide/svelte/icons/download';
import type { TimeRange } from '$lib/components/time-range-picker.svelte';
import { Button } from '$lib/components/ui/button';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import type { LogLevel } from '$lib/shared/types';

interface Props {
  projectId: string;
  level?: LogLevel[];
  search?: string;
  range?: TimeRange;
}

const { projectId, level, search, range }: Props = $props();

/**
 * Get time range start date based on range parameter
 */
function getTimeRangeStart(timeRange: TimeRange | undefined): Date | null {
  if (!timeRange) return null;

  const now = Date.now();
  switch (timeRange) {
    case '15m':
      return new Date(now - 15 * 60 * 1000);
    case '1h':
      return new Date(now - 60 * 60 * 1000);
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000);
    case '7d':
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

/**
 * Build export URL with current filters
 */
function buildExportUrl(format: 'csv' | 'json'): string {
  const params = new URLSearchParams();
  params.set('format', format);

  if (level && level.length > 0) {
    params.set('level', level.join(','));
  }

  if (search) {
    params.set('search', search);
  }

  // Convert time range to from/to timestamps
  const fromDate = getTimeRangeStart(range);
  if (fromDate) {
    params.set('from', fromDate.toISOString());
  }

  return `/api/projects/${projectId}/logs/export?${params}`;
}

// Reactive URLs that update when filters change
const csvUrl = $derived(buildExportUrl('csv'));
const jsonUrl = $derived(buildExportUrl('json'));
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet children({ builder })}
      <Button
        {...builder}
        variant="outline"
        size="sm"
        data-testid="export-button"
        aria-label="Export logs"
      >
        <DownloadIcon class="size-4 mr-2" />
        Export
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content>
    <a
      href={csvUrl}
      download
      data-testid="export-csv"
      class="relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
    >
      Download CSV
    </a>
    <a
      href={jsonUrl}
      download
      data-testid="export-json"
      class="relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
    >
      Download JSON
    </a>
  </DropdownMenu.Content>
</DropdownMenu.Root>
