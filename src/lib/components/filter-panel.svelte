<script lang="ts">
import FilterIcon from '@lucide/svelte/icons/filter';
import XIcon from '@lucide/svelte/icons/x';
import type { Snippet } from 'svelte';
import { Button } from '$lib/components/ui/button/index.js';

interface Props {
  /**
   * Number of active filters to display in badge
   */
  activeFilterCount?: number;
  /**
   * The filter content to render in the panel
   */
  children: Snippet;
}

const { activeFilterCount = 0, children }: Props = $props();

let isOpen = $state(false);

function toggle() {
  isOpen = !isOpen;
}

function close() {
  isOpen = false;
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isOpen) {
    close();
  }
}

// Add global keydown listener when panel is open
$effect(() => {
  if (isOpen && typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }
  return undefined;
});
</script>

<!-- Mobile filter toggle - only visible on mobile (< 640px) -->
<div class="sm:hidden">
  <Button
    data-testid="filter-toggle"
    variant="outline"
    size="sm"
    onclick={toggle}
    aria-label="Toggle filters"
    aria-expanded={isOpen}
    class="relative"
  >
    <FilterIcon class="size-4 mr-2" />
    Filters
    {#if activeFilterCount > 0}
      <span
        data-testid="filter-count-badge"
        class="absolute -top-1 -right-1 size-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center"
      >
        {activeFilterCount}
      </span>
    {/if}
  </Button>
</div>

<!-- Collapsible filter panel - mobile only -->
{#if isOpen}
  <div
    data-testid="filter-panel"
    class="fixed inset-x-0 bottom-0 z-40 bg-background border-t p-4 space-y-4 sm:hidden animate-in slide-in-from-bottom duration-200"
  >
    <div class="flex items-center justify-between">
      <h3 class="font-medium">Filters</h3>
      <Button variant="ghost" size="sm" onclick={close} aria-label="Close filters">
        <XIcon class="size-4" />
      </Button>
    </div>

    <div data-testid="filter-panel-content" class="space-y-4">
      {@render children()}
    </div>
  </div>

  <!-- Backdrop for mobile filter panel -->
  <button
    type="button"
    class="fixed inset-0 z-30 bg-black/50 sm:hidden cursor-default"
    onclick={close}
    aria-label="Close filter panel"
  ></button>
{/if}

<!-- Desktop/Tablet: render filters inline - visible on sm and above -->
<div data-testid="filter-desktop" class="hidden sm:contents">
  {@render children()}
</div>
