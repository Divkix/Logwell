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

<tr
  data-testid="log-row"
  data-selected={isSelected}
  aria-current={isSelected || undefined}
  class={cn(
    'cursor-pointer hover:bg-muted/50 transition-colors border-b',
    isSelected && 'bg-primary/10 ring-1 ring-primary/50',
    className
  )}
  class:log-new={isNew}
  role="button"
  tabindex="0"
  onclick={handleClick}
  onkeydown={handleKeyDown}
>
  <td class="px-4 py-2">
    <span
      data-testid="log-timestamp-desktop"
      class="font-mono text-sm text-muted-foreground whitespace-nowrap"
    >
      {formattedTimestamp}
    </span>
  </td>

  <td class="px-4 py-2">
    <LevelBadge level={log.level} />
  </td>

  <td class="px-4 py-2">
    <span
      data-testid="log-message-desktop"
      class="text-sm truncate block max-w-md"
      title={log.message}
    >
      {log.message}
    </span>
    {#if sourceInfo}
      <span class="text-xs text-muted-foreground font-mono">
        {sourceInfo}
      </span>
    {/if}
  </td>
</tr>
