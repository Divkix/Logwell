<script lang="ts">
import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
import type { Snippet } from 'svelte';

interface Props {
  children: Snippet<[{ builder: Record<string, unknown> }]>;
  class?: string;
}

const { children, class: className }: Props = $props();
</script>

<DropdownMenuPrimitive.Trigger class={className}>
  {#snippet child({ props })}
    {@render children({ builder: props })}
  {/snippet}
</DropdownMenuPrimitive.Trigger>
