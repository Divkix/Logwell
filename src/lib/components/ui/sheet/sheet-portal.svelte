<script lang="ts">
import { Dialog as SheetPrimitive } from 'bits-ui';

const { ...restProps }: SheetPrimitive.PortalProps = $props();
</script>

<SheetPrimitive.Portal {...restProps} />
