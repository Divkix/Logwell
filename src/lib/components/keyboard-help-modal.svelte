<script lang="ts">
import XIcon from '@lucide/svelte/icons/x';
import { cn } from '$lib/utils';
import { focusTrap } from '$lib/utils/focus-trap';
import { SHORTCUTS } from '$lib/utils/keyboard';

interface Props {
  open: boolean;
  onClose?: () => void;
  class?: string;
}

const { open, onClose, class: className }: Props = $props();

let previouslyFocusedElement: HTMLElement | null = $state(null);

// Store the previously focused element when modal opens
$effect(() => {
  if (open && !previouslyFocusedElement) {
    previouslyFocusedElement = document.activeElement as HTMLElement;
  }
});

// Restore focus when modal closes
$effect(() => {
  if (!open && previouslyFocusedElement) {
    previouslyFocusedElement.focus();
    previouslyFocusedElement = null;
  }
});

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    onClose?.();
  }
}

// Group shortcuts by category
const navigationShortcuts = $derived(SHORTCUTS.filter((s) => s.group === 'navigation'));
const searchShortcuts = $derived(SHORTCUTS.filter((s) => s.group === 'search'));
const otherShortcuts = $derived(SHORTCUTS.filter((s) => s.group === 'other'));
</script>

<svelte:document onkeydown={handleKeyDown} />

{#if open}
  <!-- Backdrop -->
  <button
    type="button"
    data-testid="modal-overlay"
    class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-200 cursor-default"
    onclick={() => onClose?.()}
    aria-label="Close dialog"
    tabindex="-1"
  ></button>

  <!-- Dialog -->
  <div
    role="dialog"
    aria-labelledby="keyboard-help-title"
    aria-modal="true"
    tabindex="-1"
    data-testid="keyboard-help-modal"
    use:focusTrap={{ initialFocus: '[data-testid="close-button"]' }}
    class={cn(
      'bg-background fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6 shadow-lg animate-in fade-in-0 zoom-in-95 duration-200',
      className,
    )}
  >
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <h2 id="keyboard-help-title" class="text-lg font-semibold">Keyboard Shortcuts</h2>
      <button
        type="button"
        data-testid="close-button"
        aria-label="Close keyboard shortcuts help"
        class="ring-offset-background focus:ring-ring rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2"
        onclick={() => onClose?.()}
      >
        <XIcon class="size-4" aria-hidden="true" />
      </button>
    </div>

    <!-- Content -->
    <div class="space-y-6">
      <!-- Navigation shortcuts -->
      <section>
        <h3 class="text-muted-foreground mb-2 text-sm font-medium">Navigation</h3>
        <ul class="space-y-1">
          {#each navigationShortcuts as shortcut}
            <li class="flex items-center justify-between">
              <span class="text-sm">{shortcut.description}</span>
              <kbd
                class="bg-muted rounded border px-2 py-0.5 font-mono text-xs"
                aria-label="Key {shortcut.key}"
              >
                {shortcut.key}
              </kbd>
            </li>
          {/each}
        </ul>
      </section>

      <!-- Search shortcuts -->
      <section>
        <h3 class="text-muted-foreground mb-2 text-sm font-medium">Search & Filters</h3>
        <ul class="space-y-1">
          {#each searchShortcuts as shortcut}
            <li class="flex items-center justify-between">
              <span class="text-sm">{shortcut.description}</span>
              <kbd
                class="bg-muted rounded border px-2 py-0.5 font-mono text-xs"
                aria-label="Key {shortcut.key}"
              >
                {shortcut.key}
              </kbd>
            </li>
          {/each}
        </ul>
      </section>

      <!-- Other shortcuts -->
      <section>
        <h3 class="text-muted-foreground mb-2 text-sm font-medium">Other</h3>
        <ul class="space-y-1">
          {#each otherShortcuts as shortcut}
            <li class="flex items-center justify-between">
              <span class="text-sm">{shortcut.description}</span>
              <kbd
                class="bg-muted rounded border px-2 py-0.5 font-mono text-xs"
                aria-label="Key {shortcut.key}"
              >
                {shortcut.key}
              </kbd>
            </li>
          {/each}
        </ul>
      </section>
    </div>
  </div>
{/if}
