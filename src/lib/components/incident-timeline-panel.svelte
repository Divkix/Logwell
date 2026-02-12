<script lang="ts">
import XIcon from '@lucide/svelte/icons/x';
import type { IncidentDetail, IncidentTimelineResponse } from '$lib/shared/types';
import { formatFullDate } from '$lib/utils/format';
import IncidentStatusBadge from './incident-status-badge.svelte';
import LevelBadge from './level-badge.svelte';
import Button from './ui/button/button.svelte';

interface Props {
  detail: IncidentDetail | null;
  timeline: IncidentTimelineResponse | null;
  loading?: boolean;
  onClose?: () => void;
}

const { detail, timeline, loading = false, onClose }: Props = $props();

const maxBucketCount = $derived(
  timeline ? Math.max(...timeline.buckets.map((bucket) => bucket.count), 1) : 1,
);
</script>

<aside
  data-testid="incident-timeline-panel"
  class="rounded-lg border p-4 sm:p-5 space-y-4"
  aria-live="polite"
>
  <div class="flex items-start justify-between gap-3">
    <div class="space-y-1">
      <h3 class="text-base font-semibold">Incident Timeline</h3>
      <p class="text-xs text-muted-foreground">Root-cause candidates and correlated identifiers</p>
    </div>
    {#if onClose}
      <Button variant="ghost" size="sm" onclick={() => onClose?.()} aria-label="Close timeline panel">
        <XIcon class="size-4" />
      </Button>
    {/if}
  </div>

  {#if loading}
    <div class="space-y-3">
      <div class="h-5 w-2/3 rounded bg-accent animate-pulse"></div>
      <div class="h-24 w-full rounded bg-accent animate-pulse"></div>
      <div class="h-16 w-full rounded bg-accent animate-pulse"></div>
    </div>
  {:else if !detail}
    <div class="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      Select an incident to view timeline and correlations
    </div>
  {:else}
    <div class="space-y-4">
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <IncidentStatusBadge status={detail.status} />
          <LevelBadge level={detail.highestLevel} />
        </div>
        <p class="text-sm font-medium">{detail.title}</p>
        <p class="text-xs font-mono text-muted-foreground">{detail.fingerprint}</p>
      </div>

      <div class="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <p>First seen: <span class="font-mono text-foreground">{formatFullDate(new Date(detail.firstSeen))}</span></p>
        <p>Last seen: <span class="font-mono text-foreground">{formatFullDate(new Date(detail.lastSeen))}</span></p>
        <p>Total events: <span class="font-medium text-foreground">{detail.totalEvents.toLocaleString()}</span></p>
        <p>Reopens: <span class="font-medium text-foreground">{detail.reopenCount.toLocaleString()}</span></p>
      </div>

      <section class="space-y-2">
        <h4 class="text-sm font-medium">Volume Over Time</h4>
        {#if timeline}
          <div class="rounded-md border p-3">
            <div class="mb-2 flex h-24 items-end gap-1 overflow-hidden">
              {#each timeline.buckets as bucket, index (`${bucket.timestamp}-${index}`)}
                <div
                  class="flex-1 rounded-sm bg-blue-500/60 min-w-[2px]"
                  style={`height: ${(bucket.count / maxBucketCount) * 100}%`}
                  title={`${bucket.timestamp}: ${bucket.count}`}
                ></div>
              {/each}
            </div>
            {#if timeline.peakBucket}
              <p class="text-xs text-muted-foreground">
                Peak: <span class="font-mono text-foreground">{timeline.peakBucket.timestamp}</span>
                ({timeline.peakBucket.count} events)
              </p>
            {/if}
          </div>
        {:else}
          <p class="text-xs text-muted-foreground">No timeline data available.</p>
        {/if}
      </section>

      <section class="space-y-2">
        <h4 class="text-sm font-medium">Root-Cause Candidates</h4>
        {#if detail.rootCauseCandidates.length === 0}
          <p class="text-xs text-muted-foreground">No source candidates found.</p>
        {:else}
          <ul class="space-y-1 text-xs">
            {#each detail.rootCauseCandidates as candidate (`${candidate.sourceFile ?? 'unknown'}:${candidate.lineNumber ?? 0}`)}
              <li class="rounded bg-muted/40 px-2 py-1 font-mono">
                {(candidate.sourceFile ?? 'unknown')}:{candidate.lineNumber ?? 0}
                <span class="ml-2 text-muted-foreground">({candidate.count})</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="space-y-2">
        <h4 class="text-sm font-medium">Correlated Request IDs</h4>
        {#if detail.correlations.topRequestIds.length === 0}
          <p class="text-xs text-muted-foreground">No request IDs available.</p>
        {:else}
          <ul class="space-y-1 text-xs">
            {#each detail.correlations.topRequestIds.slice(0, 5) as entry (entry.requestId)}
              <li class="rounded bg-muted/40 px-2 py-1 font-mono">
                {entry.requestId}
                <span class="ml-2 text-muted-foreground">({entry.count})</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="space-y-2">
        <h4 class="text-sm font-medium">Correlated Trace IDs</h4>
        {#if detail.correlations.topTraceIds.length === 0}
          <p class="text-xs text-muted-foreground">No trace IDs available.</p>
        {:else}
          <ul class="space-y-1 text-xs">
            {#each detail.correlations.topTraceIds.slice(0, 5) as entry (entry.traceId)}
              <li class="rounded bg-muted/40 px-2 py-1 font-mono">
                {entry.traceId}
                <span class="ml-2 text-muted-foreground">({entry.count})</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  {/if}
</aside>
