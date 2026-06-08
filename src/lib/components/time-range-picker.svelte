<script lang="ts" module>
export type { TimeRange } from '$lib/utils/time-range';
export { TIME_RANGES, TIME_RANGE_LABELS } from '$lib/utils/time-range';
</script>

<script lang="ts">
import { Button } from '$lib/components/ui/button/index.js';
import { TIME_RANGE_LABELS, TIME_RANGES } from '$lib/utils/time-range';

interface Props {
  value?: TimeRange;
  disabled?: boolean;
  onchange?: (value: TimeRange) => void;
}

let {
  value = $bindable('1h'),
  disabled = false,
  onchange,
}: Props = $props();

function handleClick(range: TimeRange) {
  if (range === value) return;
  value = range;
  onchange?.(range);
}
</script>

<div class="flex gap-1" role="group" aria-label="Time range selector">
  {#each TIME_RANGES as range}
    <Button
      variant={value === range ? 'default' : 'outline'}
      size="sm"
      {disabled}
      aria-pressed={value === range}
      aria-label={TIME_RANGE_LABELS[range]}
      data-selected={value === range}
      onclick={() => handleClick(range)}
    >
      {range}
    </Button>
  {/each}
</div>
