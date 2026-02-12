<script lang="ts">
import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
import ChartPieIcon from '@lucide/svelte/icons/chart-pie';
import LoaderIcon from '@lucide/svelte/icons/loader';
import SettingsIcon from '@lucide/svelte/icons/settings';
import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
import { goto } from '$app/navigation';
import { navigating } from '$app/stores';
import ActiveFilterChips from '$lib/components/active-filter-chips.svelte';
import BottomNav from '$lib/components/bottom-nav.svelte';
import ClearFiltersButton from '$lib/components/clear-filters-button.svelte';
import ConnectionStatus from '$lib/components/connection-status.svelte';
import ExportButton from '$lib/components/export-button.svelte';
import FilterPanel from '$lib/components/filter-panel.svelte';
import KeyboardHelpModal from '$lib/components/keyboard-help-modal.svelte';
import LevelFilter from '$lib/components/level-filter.svelte';
import LiveToggle from '$lib/components/live-toggle.svelte';
import LogDetailModal from '$lib/components/log-detail-modal.svelte';
import LogStreamSkeleton from '$lib/components/log-stream-skeleton.svelte';
import LogTable from '$lib/components/log-table.svelte';
import SearchInput from '$lib/components/search-input.svelte';
import TimeRangePicker, { type TimeRange } from '$lib/components/time-range-picker.svelte';
import Button from '$lib/components/ui/button/button.svelte';
import { useLogStream } from '$lib/hooks/use-log-stream.svelte';
import type { Log, LogLevel, Project } from '$lib/server/db/schema';
import type { ClientLog } from '$lib/stores/logs.svelte';
import { announceToScreenReader } from '$lib/utils/focus-trap';
import { shouldBlockShortcut } from '$lib/utils/keyboard';
import { toastError } from '$lib/utils/toast';
import type { PageData } from './$types';

const { data }: { data: PageData } = $props();

// Show skeleton when navigating TO this page (project logs page, not stats)
const isNavigating = $derived(
  $navigating?.to?.url.pathname.includes('/projects/') &&
    !$navigating?.to?.url.pathname.endsWith('/stats'),
);

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

// Convert server project data to Project type (reactive to handle invalidateAll)
// Note: ownerId is intentionally not exposed to client
const projectData = $derived<Omit<Project, 'ownerId'>>({
  id: data.project.id,
  name: data.project.name,
  apiKey: data.project.apiKey,
  retentionDays: data.project.retentionDays ?? null,
  createdAt: data.project.createdAt ? new Date(data.project.createdAt) : null,
  updatedAt: data.project.updatedAt ? new Date(data.project.updatedAt) : null,
});

// Local state (intentionally capture initial values - managed via URL navigation)
let liveEnabled = $state(true);
// svelte-ignore state_referenced_locally
let searchValue = $state(data.filters.search);
// svelte-ignore state_referenced_locally
let selectedLevels = $state<LogLevel[]>(data.filters.levels);
// svelte-ignore state_referenced_locally
let selectedRange = $state<TimeRange>((data.filters.range as TimeRange) || '1h');
let selectedLog = $state<Log | null>(null);
let showDetailModal = $state(false);
let showHelpModal = $state(false);
let selectedIndex = $state(-1);
let loading = $state(false);
let searchInputRef = $state<HTMLInputElement | null>(null);

// Track new log IDs for highlighting
let newLogIds = $state<Set<string>>(new Set());

// Pagination state for Load More
let loadedMoreLogs = $state<Log[]>([]);
// svelte-ignore state_referenced_locally
let nextCursor = $state<string | null>(data.pagination.nextCursor ?? null);
let isLoadingMore = $state(false);

// Count active filters for badge
const activeFilterCount = $derived(
  (selectedLevels.length > 0 ? 1 : 0) + (searchValue ? 1 : 0) + (selectedRange !== '1h' ? 1 : 0),
);

// Derive hasFilters for empty state distinction
const hasFilters = $derived(
  Boolean(searchValue) || selectedLevels.length > 0 || selectedRange !== '1h',
);

// Live streaming is paused when search is active
const isLivePaused = $derived(Boolean(data.filters.search));

// Streamed logs from SSE
let streamedLogs = $state<Log[]>([]);

// Handle incoming logs from SSE stream
function handleIncomingLogs(logs: ClientLog[]) {
  const parsedLogs = logs.map(parseClientLog);
  const ids = parsedLogs.map((l) => l.id);
  newLogIds = new Set([...ids, ...newLogIds]);

  // Remove highlight after 3s
  setTimeout(() => {
    newLogIds = new Set([...newLogIds].filter((id) => !ids.includes(id)));
  }, 3000);

  streamedLogs = [...parsedLogs, ...streamedLogs];
}

// Track SSE connection state reactively for UI
let sseConnected = $state(false);

// Use the SSE hook for log streaming (connection managed reactively via $effect below)
// svelte-ignore state_referenced_locally
const logStream = useLogStream({
  projectId: data.project.id,
  enabled: false, // Initial state; $effect manages actual connection
  onLogs: handleIncomingLogs,
  onConnectionChange: (connected) => {
    sseConnected = connected;
  },
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

// Reset pagination state when data changes (filters applied)
$effect(() => {
  // This runs when data.logs changes (after navigation with new filters)
  loadedMoreLogs = [];
  nextCursor = data.pagination.nextCursor ?? null;
});

// Combined logs: streamed + server-loaded + loaded more (with proper Date conversion)
const allLogs = $derived([...streamedLogs, ...data.logs.map(parseLogTimestamp), ...loadedMoreLogs]);

function handleSearch(value: string) {
  searchValue = value;
  selectedIndex = -1;
  updateFilters();
}

function handleLevelChange(levels: LogLevel[]) {
  selectedLevels = levels;
  selectedIndex = -1;
  updateFilters();
}

function handleTimeRangeChange(range: TimeRange) {
  selectedRange = range;
  selectedIndex = -1;
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

async function handleViewIncident(incidentId: string) {
  await goto(`/projects/${data.project.id}/incidents?status=open&range=24h&incident=${incidentId}`);
}

async function loadMore() {
  if (!nextCursor || isLoadingMore) return;
  isLoadingMore = true;

  try {
    const params = new URLSearchParams();
    params.set('cursor', nextCursor);
    if (searchValue) params.set('search', searchValue);
    if (selectedLevels.length > 0) params.set('level', selectedLevels.join(','));
    params.set('range', selectedRange);

    const response = await fetch(`/api/projects/${data.project.id}/logs?${params}`);
    const result = await response.json();

    loadedMoreLogs = [...loadedMoreLogs, ...result.logs.map(parseLogTimestamp)];
    nextCursor = result.nextCursor;
  } catch (error) {
    toastError('Failed to load more logs');
  } finally {
    isLoadingMore = false;
  }
}

function clearFilters() {
  searchValue = '';
  selectedLevels = [];
  selectedRange = '1h';
  selectedIndex = -1;
  updateFilters();
}

function handleRemoveLevel(level: LogLevel) {
  selectedLevels = selectedLevels.filter((l) => l !== level);
  updateFilters();
}

function handleRemoveSearch() {
  searchValue = '';
  updateFilters();
}

function handleRemoveRange() {
  selectedRange = '1h';
  updateFilters();
}

function scrollSelectedIntoView() {
  const element = document.querySelector('[data-selected="true"]');
  element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function handleKeyboardShortcut(event: KeyboardEvent) {
  // Block shortcuts in form elements, during IME composition, or with modifiers
  if (shouldBlockShortcut(event)) {
    return;
  }

  // Block shortcuts when modal is open
  if (showDetailModal || showHelpModal) {
    return;
  }

  // Block navigation during loading state
  const isLoading = loading || isLoadingMore;

  switch (event.key) {
    case 'j': {
      // Skip navigation when loading or no logs
      if (isLoading || allLogs.length === 0) return;
      // Navigate to next log
      const prevIndexJ = selectedIndex;
      if (selectedIndex < allLogs.length - 1) {
        selectedIndex++;
      } else if (selectedIndex === -1 && allLogs.length > 0) {
        selectedIndex = 0;
      }
      if (selectedIndex !== prevIndexJ) {
        scrollSelectedIntoView();
        announceToScreenReader(`Log ${selectedIndex + 1} of ${allLogs.length}`);
      }
      break;
    }
    case 'k': {
      // Skip navigation when loading or no logs
      if (isLoading || allLogs.length === 0) return;
      // Navigate to previous log
      const prevIndexK = selectedIndex;
      if (selectedIndex > 0) {
        selectedIndex--;
      }
      if (selectedIndex !== prevIndexK) {
        scrollSelectedIntoView();
        announceToScreenReader(`Log ${selectedIndex + 1} of ${allLogs.length}`);
      }
      break;
    }
    case 'Enter':
      // Open modal for selected log (only when a log is selected)
      if (selectedIndex >= 0 && selectedIndex < allLogs.length) {
        selectedLog = allLogs[selectedIndex];
        showDetailModal = true;
        event.preventDefault();
      }
      // Don't preventDefault when no selection - allow buttons to work normally
      break;
    case '/':
      // Focus search input
      event.preventDefault();
      searchInputRef?.focus();
      break;
    case 'l':
      // Toggle live mode (skip if paused due to search)
      if (isLivePaused) return;
      liveEnabled = !liveEnabled;
      break;
    case '?':
      // Open help modal
      showHelpModal = true;
      event.preventDefault();
      break;
  }
}
</script>

<svelte:document onkeydown={handleKeyboardShortcut} />

{#if isNavigating}
  <LogStreamSkeleton />
{:else}
  <div class="space-y-4 sm:space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 sm:gap-4 min-w-0">
        <a
          href="/"
          class="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Back to dashboard"
        >
          <ArrowLeftIcon class="size-4" />
          <span class="sr-only">Dashboard</span>
        </a>
        <h1 class="text-lg sm:text-2xl font-bold truncate">{data.project.name}</h1>
      </div>

      <!-- Desktop/Tablet header actions -->
      <div data-testid="project-header-actions" class="hidden sm:flex items-center gap-2">
        <a
          href="/projects/{data.project.id}/incidents"
          class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
          aria-label="View incidents"
        >
          <TriangleAlertIcon class="size-4 mr-2" />
          Incidents
        </a>
        <a
          href="/projects/{data.project.id}/stats"
          class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
          aria-label="View statistics"
        >
          <ChartPieIcon class="size-4 mr-2" />
          Stats
        </a>
        <a
          href="/projects/{data.project.id}/settings"
          class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
          aria-label="Settings"
        >
          <SettingsIcon class="size-4 mr-2" />
          Settings
        </a>
      </div>
    </div>

    <!-- Filters Bar -->
    <div class="flex flex-wrap items-center gap-2 sm:gap-4">
      <!-- Live Toggle - always visible -->
      <LiveToggle bind:enabled={liveEnabled} disabled={isLivePaused} isConnected={sseConnected} />

      <!-- Connection Status -->
      <ConnectionStatus isConnecting={logStream.isConnecting} error={logStream.error} />

      {#if isLivePaused}
        <span
          data-testid="live-paused-notice"
          class="text-xs sm:text-sm text-muted-foreground bg-muted px-2 py-1 rounded"
        >
          Live paused during search
        </span>
      {/if}

      <!-- Filter Panel - collapsible on mobile, inline on desktop -->
      <FilterPanel {activeFilterCount}>
        <!-- Search Input -->
        <div data-testid="search-container" class="w-full sm:w-auto sm:flex-1 sm:max-w-sm">
          <SearchInput
            bind:value={searchValue}
            bind:ref={searchInputRef}
            placeholder="Search logs..."
            onsearch={handleSearch}
          />
        </div>

        <!-- Level Filter -->
        <div class="w-full sm:w-auto overflow-x-auto">
          <LevelFilter value={selectedLevels} onchange={handleLevelChange} />
        </div>

        <!-- Time Range Picker -->
        <div class="w-full sm:w-auto">
          <TimeRangePicker value={selectedRange} onchange={handleTimeRangeChange} />
        </div>

        <!-- Export Button - only show when logs exist -->
        {#if allLogs.length > 0}
          <div class="w-full sm:w-auto">
            <ExportButton
              projectId={data.project.id}
              level={selectedLevels.length > 0 ? selectedLevels : undefined}
              search={searchValue || undefined}
              range={selectedRange}
            />
          </div>
        {/if}

        <!-- Clear Filters Button -->
        <ClearFiltersButton visible={activeFilterCount > 0} onclick={clearFilters} />
      </FilterPanel>

      <!-- Active Filter Chips (Desktop) -->
      <ActiveFilterChips
        levels={selectedLevels}
        search={searchValue}
        range={selectedRange}
        onRemoveLevel={handleRemoveLevel}
        onRemoveSearch={handleRemoveSearch}
        onRemoveRange={handleRemoveRange}
      />
    </div>

    <!-- Log Table (responsive: cards on mobile, table on desktop) -->
    <LogTable
      logs={allLogs}
      {loading}
      {hasFilters}
      onLogClick={handleLogClick}
      {newLogIds}
      project={projectData}
      appUrl={data.appUrl ?? undefined}
      {selectedIndex}
    />

    <!-- Load More Button -->
    {#if nextCursor}
      <div class="flex justify-center py-4">
        <Button
          data-testid="load-more-button"
          variant="outline"
          onclick={loadMore}
          disabled={isLoadingMore}
        >
          {#if isLoadingMore}
            <LoaderIcon class="size-4 mr-2 animate-spin" />
            Loading...
          {:else}
            Load More
          {/if}
        </Button>
      </div>
    {/if}

    <!-- Pagination Info -->
    {#if data.pagination.total > 0}
      <div class="text-xs sm:text-sm text-muted-foreground">
        Showing {Math.min(allLogs.length, data.pagination.limit)} of {data.pagination.total} logs
        {#if data.pagination.hasMore}
          <span class="ml-2">(more available)</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<!-- Log Detail Modal -->
{#if selectedLog}
  <LogDetailModal
    log={selectedLog}
    open={showDetailModal}
    onClose={closeDetailModal}
    onViewIncident={handleViewIncident}
  />
{/if}

<!-- Keyboard Help Modal -->
<KeyboardHelpModal open={showHelpModal} onClose={() => showHelpModal = false} />

<!-- Mobile Bottom Navigation -->
<BottomNav projectId={data.project.id} />
