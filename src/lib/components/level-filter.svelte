<script lang="ts">
import { Button } from '$lib/components/ui/button/index.js';
import { LOG_LEVELS, type LogLevel } from '$lib/shared/types';

interface Props {
  value?: LogLevel[];
  disabled?: boolean;
  onchange?: (levels: LogLevel[]) => void;
}

let { value = $bindable([]), disabled = false, onchange }: Props = $props();

function toggleLevel(level: LogLevel) {
  const newLevels = value.includes(level) ? value.filter((l) => l !== level) : [...value, level];

  value = newLevels;
  onchange?.(newLevels);
}

const levelColors: Record<LogLevel, string> = {
  debug: 'bg-gray-400',
  info: 'bg-blue-500',
  warn: 'bg-yellow-500',
  error: 'bg-red-500',
  fatal: 'bg-purple-600',
};
</script>

<div data-testid="level-filter" class="flex gap-1" role="group" aria-label="Log level filter">
  {#each LOG_LEVELS as level}
    <Button
      variant={value.includes(level) || value.length === 0 ? 'default' : 'outline'}
      size="sm"
      {disabled}
      aria-pressed={value.includes(level)}
      onclick={() => toggleLevel(level)}
      class="text-xs px-2"
    >
      <span class="size-2 rounded-full {levelColors[level]} mr-1"></span>
      {level.toUpperCase()}
    </Button>
  {/each}
</div>
