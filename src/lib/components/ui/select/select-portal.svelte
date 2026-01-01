<script lang="ts">
import { Select as SelectPrimitive } from 'bits-ui';

const { ...restProps }: SelectPrimitive.PortalProps = $props();
</script>

<SelectPrimitive.Portal {...restProps} />
