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

function exportLogs(format: 'csv' | 'json') {
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

  window.location.href = `/api/projects/${projectId}/logs/export?${params}`;
}
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
    <DropdownMenu.Item data-testid="export-csv" onclick={() => exportLogs('csv')}>
      Download CSV
    </DropdownMenu.Item>
    <DropdownMenu.Item data-testid="export-json" onclick={() => exportLogs('json')}>
      Download JSON
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
