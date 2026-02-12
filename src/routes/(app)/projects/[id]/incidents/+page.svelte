<script lang="ts">
import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
import LoaderIcon from '@lucide/svelte/icons/loader';
import { goto } from '$app/navigation';
import { navigating } from '$app/stores';
import BottomNav from '$lib/components/bottom-nav.svelte';
import IncidentTable from '$lib/components/incident-table.svelte';
import IncidentTimelinePanel from '$lib/components/incident-timeline-panel.svelte';
import Button from '$lib/components/ui/button/button.svelte';
import { type ClientIncident, useIncidentStream } from '$lib/hooks/use-incident-stream.svelte';
import type {
  IncidentDetail,
  IncidentListItem,
  IncidentRange,
  IncidentStatus,
  IncidentTimelineResponse,
} from '$lib/shared/types';
import type { PageData } from './$types';

const { data }: { data: PageData } = $props();
// svelte-ignore state_referenced_locally
const projectId = data.project.id;

const isNavigating = $derived($navigating?.to?.url.pathname.endsWith('/incidents') ?? false);

// svelte-ignore state_referenced_locally
let incidents = $state<IncidentListItem[]>([...data.incidents]);
// svelte-ignore state_referenced_locally
let nextCursor = $state<string | null>(data.pagination.nextCursor ?? null);
let isLoadingMore = $state(false);
// svelte-ignore state_referenced_locally
let selectedStatus = $state<IncidentStatus>(data.filters.status as IncidentStatus);
// svelte-ignore state_referenced_locally
let selectedRange = $state<IncidentRange>(data.filters.range as IncidentRange);
// svelte-ignore state_referenced_locally
let selectedIncidentId = $state<string | null>(data.filters.selectedIncidentId ?? null);
let detail = $state<IncidentDetail | null>(null);
let timeline = $state<IncidentTimelineResponse | null>(null);
let detailLoading = $state(false);
let refreshTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

function computeStatus(lastSeenIso: string): IncidentStatus {
  const thresholdMs = 30 * 60 * 1000;
  const diff = Date.now() - new Date(lastSeenIso).getTime();
  return diff <= thresholdMs ? 'open' : 'resolved';
}

function normalizeClientIncident(incident: ClientIncident): IncidentListItem {
  return {
    id: incident.id,
    projectId: incident.projectId,
    fingerprint: incident.fingerprint,
    title: incident.title,
    normalizedMessage: incident.normalizedMessage,
    serviceName: incident.serviceName,
    sourceFile: incident.sourceFile,
    lineNumber: incident.lineNumber,
    highestLevel: incident.highestLevel,
    firstSeen: incident.firstSeen,
    lastSeen: incident.lastSeen,
    totalEvents: incident.totalEvents,
    reopenCount: incident.reopenCount,
    status: computeStatus(incident.lastSeen),
  };
}

function mergeIncidentUpdates(updates: ClientIncident[]) {
  const normalized = updates.map(normalizeClientIncident);
  const byId = new Map(incidents.map((item) => [item.id, item]));
  for (const item of normalized) {
    byId.set(item.id, item);
  }

  incidents = [...byId.values()]
    .filter((item) => {
      if (selectedStatus === 'open') return item.status === 'open';
      if (selectedStatus === 'resolved') return item.status === 'resolved';
      return true;
    })
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
}

const incidentStream = useIncidentStream({
  projectId,
  enabled: false,
  onIncidents: (updates) => {
    if (refreshTimeout) {
      clearTimeout(refreshTimeout);
    }
    refreshTimeout = setTimeout(() => {
      mergeIncidentUpdates(updates);
      refreshTimeout = null;
    }, 300);
  },
});

$effect(() => {
  incidentStream.connect();
  return () => {
    incidentStream.disconnect();
    if (refreshTimeout) clearTimeout(refreshTimeout);
  };
});

async function fetchIncidentDetail(incidentId: string) {
  detailLoading = true;
  try {
    const [detailRes, timelineRes] = await Promise.all([
      fetch(`/api/projects/${projectId}/incidents/${incidentId}`),
      fetch(`/api/projects/${projectId}/incidents/${incidentId}/timeline?range=${selectedRange}`),
    ]);

    if (!detailRes.ok || !timelineRes.ok) {
      detail = null;
      timeline = null;
      return;
    }

    detail = await detailRes.json();
    timeline = await timelineRes.json();
  } finally {
    detailLoading = false;
  }
}

$effect(() => {
  if (selectedIncidentId) {
    fetchIncidentDetail(selectedIncidentId);
  } else {
    detail = null;
    timeline = null;
  }
});

async function applyFilters() {
  selectedIncidentId = null;
  const params = new URLSearchParams();
  params.set('status', selectedStatus);
  params.set('range', selectedRange);
  await goto(`/projects/${projectId}/incidents?${params.toString()}`, {
    replaceState: true,
    noScroll: true,
  });
}

async function selectIncident(incidentId: string) {
  selectedIncidentId = incidentId;
  const params = new URLSearchParams();
  params.set('status', selectedStatus);
  params.set('range', selectedRange);
  params.set('incident', incidentId);
  await goto(`/projects/${projectId}/incidents?${params.toString()}`, {
    replaceState: true,
    noScroll: true,
  });
}

async function clearSelection() {
  selectedIncidentId = null;
  const params = new URLSearchParams();
  params.set('status', selectedStatus);
  params.set('range', selectedRange);
  await goto(`/projects/${projectId}/incidents?${params.toString()}`, {
    replaceState: true,
    noScroll: true,
  });
}

async function loadMore() {
  if (!nextCursor || isLoadingMore) return;
  isLoadingMore = true;
  try {
    const params = new URLSearchParams();
    params.set('cursor', nextCursor);
    params.set('status', selectedStatus);
    params.set('range', selectedRange);
    const response = await fetch(`/api/projects/${projectId}/incidents?${params.toString()}`);
    if (!response.ok) return;

    const result = await response.json();
    incidents = [...incidents, ...result.incidents];
    nextCursor = result.nextCursor;
  } finally {
    isLoadingMore = false;
  }
}
</script>

{#if isNavigating}
  <div class="space-y-4">
    <div class="h-8 w-64 rounded bg-accent animate-pulse"></div>
    <div class="h-80 rounded bg-accent animate-pulse"></div>
  </div>
{:else}
  <div class="space-y-4 sm:space-y-6">
    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2 sm:gap-4">
        <a
          href="/projects/{projectId}"
          class="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Back to logs"
        >
          <ArrowLeftIcon class="size-4" />
          <span class="sr-only">Logs</span>
        </a>
        <h1 class="truncate text-lg font-bold sm:text-2xl">{data.project.name}</h1>
      </div>
    </div>

    <div class="rounded-lg border p-3 sm:p-4">
      <div class="flex flex-wrap items-center gap-2 sm:gap-3">
        <label class="text-sm text-muted-foreground" for="incident-status">Status</label>
        <select
          id="incident-status"
          class="rounded-md border bg-background px-2 py-1 text-sm"
          bind:value={selectedStatus}
          onchange={applyFilters}
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>

        <label class="text-sm text-muted-foreground" for="incident-range">Range</label>
        <select
          id="incident-range"
          class="rounded-md border bg-background px-2 py-1 text-sm"
          bind:value={selectedRange}
          onchange={applyFilters}
        >
          <option value="15m">Last 15m</option>
          <option value="1h">Last 1h</option>
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7d</option>
        </select>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <IncidentTable incidents={incidents} selectedIncidentId={selectedIncidentId} onSelect={selectIncident} />

      <IncidentTimelinePanel
        {detail}
        {timeline}
        loading={detailLoading}
        onClose={selectedIncidentId ? clearSelection : undefined}
      />
    </div>

    {#if nextCursor}
      <div class="flex justify-center">
        <Button variant="outline" onclick={loadMore} disabled={isLoadingMore}>
          {#if isLoadingMore}
            <LoaderIcon class="mr-2 size-4 animate-spin" />
            Loading...
          {:else}
            Load More
          {/if}
        </Button>
      </div>
    {/if}
  </div>
{/if}

<BottomNav {projectId} />
