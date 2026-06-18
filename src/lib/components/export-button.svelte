<script lang="ts">
import DownloadIcon from '@lucide/svelte/icons/download';
import type { TimeRange } from '$lib/components/time-range-picker.svelte';
import { Button } from '$lib/components/ui/button';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import type { LogLevel } from '$lib/shared/types';
import { getTimeRangeStart } from '$lib/utils/format';
import { toastError } from '$lib/utils/toast';

interface Props {
  projectId: string;
  level?: LogLevel[];
  search?: string;
  range?: TimeRange;
}

const { projectId, level, search, range }: Props = $props();

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
  const fromDate = range ? getTimeRangeStart(range) : null;
  if (fromDate) {
    params.set('from', fromDate.toISOString());
  }

  return `/api/projects/${projectId}/logs/export?${params}`;
}

/**
 * Fetch export and trigger download, or show toast on error
 */
async function handleExport(format: 'csv' | 'json') {
  try {
    const response = await fetch(buildExportUrl(format));

    if (!response.ok) {
      let message = `Export failed: ${response.status} ${response.statusText}`;
      try {
        const data = (await response.json()) as { message?: string };
        if (data.message) message = data.message;
      } catch {
        // ignore JSON parse error
      }
      toastError(message);
      return;
    }

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);

    // Parse filename from Content-Disposition header
    const contentDisposition = response.headers.get('content-disposition');
    let filename = `logs-export.${format}`;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="([^"]+)"/);
      if (match?.[1]) filename = match[1];
    }

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(blobUrl);
  } catch {
    toastError('Export failed. Please try again.');
  }
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
    <DropdownMenu.Item onclick={() => handleExport('csv')} data-testid="export-csv">
      Download CSV
    </DropdownMenu.Item>
    <DropdownMenu.Item onclick={() => handleExport('json')} data-testid="export-json">
      Download JSON
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
