<script lang="ts">
import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
import type { Snippet } from 'svelte';

interface Props {
  children: Snippet;
}

const { children }: Props = $props();
</script>

<DropdownMenuPrimitive.Root>
  {@render children()}
</DropdownMenuPrimitive.Root>
