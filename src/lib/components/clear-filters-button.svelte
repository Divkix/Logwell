<script lang="ts">
import XIcon from '@lucide/svelte/icons/x';
import { Button } from '#lib/components/ui/button/index.js';

interface Props {
  visible: boolean;
  onclick?: () => void;
}

const { visible, onclick }: Props = $props();
</script>

{#if visible}
  <Button
    data-testid="clear-filters-button"
    variant="ghost"
    size="sm"
    onclick={onclick}
    aria-label="Clear all filters"
  >
    <XIcon class="size-4 mr-1" />
    Clear
  </Button>
{/if}
