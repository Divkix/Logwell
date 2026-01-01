<script lang="ts">
import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
import ChartPieIcon from '@lucide/svelte/icons/chart-pie';
import SettingsIcon from '@lucide/svelte/icons/settings';
import { goto, invalidateAll } from '$app/navigation';
import LevelFilter from '$lib/components/level-filter.svelte';
import LiveToggle from '$lib/components/live-toggle.svelte';
import LogDetailModal from '$lib/components/log-detail-modal.svelte';
import LogTable from '$lib/components/log-table.svelte';
import ProjectSettings from '$lib/components/project-settings.svelte';
import SearchInput from '$lib/components/search-input.svelte';
import TimeRangePicker, { type TimeRange } from '$lib/components/time-range-picker.svelte';
import Button from '$lib/components/ui/button/button.svelte';
import { useLogStream } from '$lib/hooks/use-log-stream.svelte';
import type { Log, LogLevel, Project } from '$lib/server/db/schema';
import type { ClientLog } from '$lib/stores/logs.svelte';
import type { PageData } from './$types';

const { data }: { data: PageData } = $props();

// Convert server data logs (with string timestamps) to Log type (with Date timestamps)
function parseLogTimestamp(log: PageData['logs'][number]): Log {
  return {
    ...log,
    timestamp: log.timestamp ? new Date(log.timestamp) : null,
  } as Log;
}

// Convert ClientLog (from SSE) to Log type (with Date timestamps)
function parseClientLog(log: ClientLog): Log {
  return {
    ...log,
    timestamp: log.timestamp ? new Date(log.timestamp) : null,
  } as Log;
}

// Convert server project data to Project type
const projectData: Project = {
  id: data.project.id,
  name: data.project.name,
  apiKey: data.project.apiKey,
  createdAt: data.project.createdAt ? new Date(data.project.createdAt) : null,
  updatedAt: data.project.updatedAt ? new Date(data.project.updatedAt) : null,
};

// Local state
let liveEnabled = $state(true);
let searchValue = $state(data.filters.search);
let selectedLevels = $state<LogLevel[]>(data.filters.levels);
let selectedRange = $state<TimeRange>((data.filters.range as TimeRange) || '1h');
let selectedLog = $state<Log | null>(null);
let showDetailModal = $state(false);
let showSettingsModal = $state(false);
let loading = $state(false);

// Live streaming is paused when search is active
const isLivePaused = $derived(Boolean(data.filters.search));

// Streamed logs from SSE
let streamedLogs = $state<Log[]>([]);

// Handle incoming logs from SSE stream
function handleIncomingLogs(logs: ClientLog[]) {
  const parsedLogs = logs.map(parseClientLog);
  streamedLogs = [...parsedLogs, ...streamedLogs];
}

// Use the SSE hook for log streaming
const logStream = useLogStream({
  projectId: data.project.id,
  enabled: liveEnabled && !isLivePaused,
  onLogs: handleIncomingLogs,
});

// Manage stream connection based on liveEnabled and pause state
$effect(() => {
  if (liveEnabled && !isLivePaused) {
    logStream.connect();
  } else {
    logStream.disconnect();
  }

  return () => {
    logStream.disconnect();
  };
});

// Combined logs: server-loaded + streamed (with proper Date conversion)
const allLogs = $derived([...streamedLogs, ...data.logs.map(parseLogTimestamp)]);

function handleSearch(value: string) {
  searchValue = value;
  updateFilters();
}

function handleLevelChange(levels: LogLevel[]) {
  selectedLevels = levels;
  updateFilters();
}

function handleTimeRangeChange(range: TimeRange) {
  selectedRange = range;
  updateFilters();
}

async function updateFilters() {
  loading = true;
  streamedLogs = []; // Clear streamed logs on filter change

  const params = new URLSearchParams();
  if (searchValue) params.set('search', searchValue);
  if (selectedLevels.length > 0) params.set('level', selectedLevels.join(','));
  params.set('range', selectedRange);

  const queryString = params.toString();
  const url = queryString
    ? `/projects/${data.project.id}?${queryString}`
    : `/projects/${data.project.id}`;

  await goto(url, { replaceState: true, noScroll: true });
  loading = false;
}

function handleLogClick(log: Log) {
  selectedLog = log;
  showDetailModal = true;
}

function closeDetailModal() {
  showDetailModal = false;
  selectedLog = null;
}

function openSettings() {
  showSettingsModal = true;
}

function closeSettings() {
  showSettingsModal = false;
}

async function handleRegenerate() {
  const response = await fetch(`/api/projects/${data.project.id}/regenerate`, {
    method: 'POST',
  });

  if (response.ok) {
    await invalidateAll();
    closeSettings();
  }
}

async function handleDelete() {
  const response = await fetch(`/api/projects/${data.project.id}`, {
    method: 'DELETE',
  });

  if (response.ok) {
    await goto('/');
  }
}
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-4">
      <a
        href="/"
        class="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Back to dashboard"
      >
        <ArrowLeftIcon class="size-4" />
        <span class="sr-only">Dashboard</span>
      </a>
      <h1 class="text-2xl font-bold">{data.project.name}</h1>
    </div>
    <div class="flex items-center gap-2">
      <a
        href="/projects/{data.project.id}/stats"
        class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
        aria-label="View statistics"
      >
        <ChartPieIcon class="size-4 mr-2" />
        Stats
      </a>
      <Button variant="outline" size="sm" onclick={openSettings} aria-label="Settings">
        <SettingsIcon class="size-4 mr-2" />
        Settings
      </Button>
    </div>
  </div>

  <!-- Filters Bar -->
  <div class="flex flex-wrap items-center gap-4">
    <LiveToggle bind:enabled={liveEnabled} disabled={isLivePaused} />

    {#if isLivePaused}
      <span
        data-testid="live-paused-notice"
        class="text-sm text-muted-foreground bg-muted px-2 py-1 rounded"
      >
        Live paused during search
      </span>
    {/if}

    <div class="flex-1 max-w-sm">
      <SearchInput
        bind:value={searchValue}
        placeholder="Search logs..."
        onsearch={handleSearch}
      />
    </div>

    <LevelFilter value={selectedLevels} onchange={handleLevelChange} />

    <TimeRangePicker value={selectedRange} onchange={handleTimeRangeChange} />
  </div>

  <!-- Log Table -->
  <LogTable logs={allLogs} {loading} onLogClick={handleLogClick} />

  <!-- Pagination Info -->
  {#if data.pagination.total > 0}
    <div class="text-sm text-muted-foreground">
      Showing {Math.min(allLogs.length, data.pagination.limit)} of {data.pagination.total} logs
      {#if data.pagination.hasMore}
        <span class="ml-2">(more available)</span>
      {/if}
    </div>
  {/if}
</div>

<!-- Log Detail Modal -->
{#if selectedLog}
  <LogDetailModal log={selectedLog} open={showDetailModal} onClose={closeDetailModal} />
{/if}

<!-- Project Settings Modal -->
<ProjectSettings
  project={projectData}
  open={showSettingsModal}
  onClose={closeSettings}
  onRegenerate={handleRegenerate}
  onDelete={handleDelete}
/>
