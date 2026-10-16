<script lang="ts">
import { Switch } from '#lib/components/ui/switch/index.js';
import { cn } from '#lib/utils.js';

interface Props {
  enabled?: boolean;
  disabled?: boolean;
  isConnected?: boolean;
  onchange?: (enabled: boolean) => void;
}

let {
  enabled = $bindable(true),
  disabled = false,
  isConnected = false,
  onchange,
}: Props = $props();
</script>

<div data-testid="live-toggle" class="flex items-center gap-2">
  <span
    data-testid="live-pulse"
    data-sse-connected={isConnected}
    class={cn(
      'size-2 rounded-full transition-colors',
      enabled ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'
    )}
  ></span>
  <span class="text-sm font-medium">Live</span>
  <Switch
    bind:checked={enabled}
    {disabled}
    aria-label="Toggle live streaming"
    onCheckedChange={(checked) => onchange?.(checked)}
  />
</div>
