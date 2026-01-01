<script lang="ts">
import { Dialog as DialogPrimitive } from 'bits-ui';

const { ...restProps }: DialogPrimitive.PortalProps = $props();
</script>

<DialogPrimitive.Portal {...restProps} />
