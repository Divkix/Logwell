<script lang="ts">
import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
import type { ComponentProps, Snippet } from 'svelte';

// The primitive hands its child snippet the props it renders the trigger element with;
// deriving the type keeps this wrapper in lockstep with bits-ui instead of restating it.
type TriggerChildProps = Parameters<
  NonNullable<ComponentProps<typeof DropdownMenuPrimitive.Trigger>['child']>
>[0]['props'];

interface Props {
  children: Snippet<[{ builder: TriggerChildProps }]>;
  class?: string;
}

const { children, class: className }: Props = $props();
</script>

<DropdownMenuPrimitive.Trigger class={className}>
  {#snippet child({ props })}
    {@render children({ builder: props })}
  {/snippet}
</DropdownMenuPrimitive.Trigger>
