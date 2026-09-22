<script lang="ts">
import { Select as SelectPrimitive } from 'bits-ui';

let {
  open = $bindable(false),
  value = $bindable(),
  ...restProps
}: SelectPrimitive.RootProps = $props();

// bits-ui uses discriminated unions for single/multiple select.
// TypeScript can't infer the correct type when using $bindable() with destructuring.
// Using never cast satisfies both TypeScript and Svelte 5's bind syntax.
function getValue() {
  // SAFETY: value holds exactly the item value bits-ui stored in this Select at runtime;
  // `never` only satisfies both sides of the discriminated bindable getter/setter pair and
  // never changes the value that flows through.
  return value as never;
}

function setValue(v: never) {
  value = v;
}
</script>

<SelectPrimitive.Root bind:open bind:value={getValue, setValue} {...restProps} />
