<script lang="ts">
import type { LogLevel } from '$lib/server/db/schema';
import { cn } from '$lib/utils';
import { getLevelBgClass, getLevelColor } from '$lib/utils/colors';

interface Props {
  level: LogLevel;
  class?: string;
}

const { level, class: className }: Props = $props();

const bgClass = $derived(getLevelBgClass(level));

const textColor = $derived(getLevelColor(level));
</script>

<span
  class={cn(
    'inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium',
    bgClass,
    className
  )}
  style="color: {textColor}"
>
  {level.toUpperCase()}
</span>
