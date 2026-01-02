<script lang="ts">
import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
import type { Snippet } from 'svelte';
import { cn } from '$lib/utils';

interface Props {
  children: Snippet;
  class?: string;
  onclick?: () => void;
  'data-testid'?: string;
}

const { children, class: className, onclick, 'data-testid': testId }: Props = $props();
</script>

<DropdownMenuPrimitive.Item
  class={cn(
    'focus:bg-accent focus:text-accent-foreground relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
    className
  )}
  onselect={onclick}
  data-testid={testId}
>
  {@render children()}
</DropdownMenuPrimitive.Item>
