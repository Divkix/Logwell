<script lang="ts">
import type { Log } from '$lib/server/db/schema';
import { cn } from '$lib/utils';
import { formatTimestamp } from '$lib/utils/format';
import LevelBadge from './level-badge.svelte';

interface Props {
  log: Log;
  onclick?: (log: Log) => void;
  class?: string;
  isNew?: boolean;
  isSelected?: boolean;
}

const { log, onclick, class: className, isNew, isSelected = false }: Props = $props();

const formattedTimestamp = $derived(
  log.timestamp ? formatTimestamp(log.timestamp) : '--:--:--.---',
);

const sourceInfo = $derived.by(() => {
  if (!log.sourceFile) return null;
  if (log.lineNumber === null || log.lineNumber === undefined) {
    return log.sourceFile;
  }
  return `${log.sourceFile}:${log.lineNumber}`;
});

function handleClick() {
  onclick?.(log);
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onclick?.(log);
  }
}
</script>

<div
  data-testid="log-card"
  data-selected={isSelected}
  aria-current={isSelected || undefined}
  class={cn(
    'p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors',
    isSelected && 'bg-primary/10 ring-1 ring-primary/50',
    className,
  )}
  class:log-new={isNew}
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={handleKeyDown}
>
  <!-- Header row: Level badge + Timestamp -->
  <div class="flex items-center justify-between gap-2 mb-2">
    <span data-testid="log-level-badge-mobile">
      <LevelBadge level={log.level} />
    </span>
    <span
      data-testid="log-timestamp-mobile"
      class="font-mono text-xs text-muted-foreground"
    >
      {formattedTimestamp}
    </span>
  </div>

  <!-- Message -->
  <p
    data-testid="log-message-mobile"
    class="text-sm wrap-break-word line-clamp-3"
    title={log.message}
  >
    {log.message}
  </p>

  <!-- Source info (if available) -->
  {#if sourceInfo}
    <p class="text-xs text-muted-foreground font-mono mt-1 truncate">
      {sourceInfo}
    </p>
  {/if}
</div>
