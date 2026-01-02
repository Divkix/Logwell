<script lang="ts">
import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
import type { Snippet } from 'svelte';
import { cn } from '$lib/utils';

interface Props {
  children: Snippet;
  class?: string;
  sideOffset?: number;
}

const { children, class: className, sideOffset = 4 }: Props = $props();
</script>

<DropdownMenuPrimitive.Content
  class={cn(
    'bg-popover text-popover-foreground z-50 min-w-[8rem] overflow-hidden rounded-md border p-1 shadow-md',
    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
    className
  )}
  {sideOffset}
>
  {@render children()}
</DropdownMenuPrimitive.Content>
