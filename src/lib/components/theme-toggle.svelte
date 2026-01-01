<script lang="ts">
import Moon from '@lucide/svelte/icons/moon';
import Sun from '@lucide/svelte/icons/sun';
import { mode, toggleMode } from 'mode-watcher';
import { Button } from '$lib/components/ui/button/index.js';
</script>

<Button
  variant="ghost"
  size="icon"
  onclick={toggleMode}
  aria-label="Toggle theme"
>
  {#if mode.current === 'dark'}
    <Moon class="size-5" data-testid="moon-icon" />
  {:else}
    <Sun class="size-5" data-testid="sun-icon" />
  {/if}
</Button>
