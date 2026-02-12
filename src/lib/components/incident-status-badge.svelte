<script lang="ts">
import type { IncidentStatus } from '$lib/shared/types';
import { cn } from '$lib/utils';

interface Props {
  status: IncidentStatus;
  class?: string;
}

const { status, class: className }: Props = $props();

const label = $derived(status === 'open' ? 'OPEN' : 'RESOLVED');
</script>

<span
  data-testid="incident-status-badge"
  class={cn(
    'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
    status === 'open'
      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    className,
  )}
>
  {label}
</span>
