<script lang="ts">
import CopyIcon from '@lucide/svelte/icons/copy';
import XIcon from '@lucide/svelte/icons/x';
import { cn } from '$lib/utils';
import { announceToScreenReader, focusTrap } from '$lib/utils/focus-trap';
import { toastError, toastSuccess } from '$lib/utils/toast';
import Button from './ui/button/button.svelte';

interface Props {
  open: boolean;
  apiKey: string;
  onClose?: () => void;
  class?: string;
}

const { open, apiKey, onClose, class: className }: Props = $props();

function handleClose() {
  onClose?.();
}

function handleKeyDown(event: KeyboardEvent) {
  if (!open) return;
  if (event.key === 'Escape') {
    handleClose();
  }
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(apiKey);
    toastSuccess('API key copied to clipboard');
    announceToScreenReader('API key copied to clipboard');
  } catch {
    toastError('Failed to copy to clipboard');
  }
}
</script>

<svelte:document onkeydown={handleKeyDown} />

{#if open}
  <!-- Backdrop -->
  <button
    type="button"
    data-testid="api-key-reveal-overlay"
    class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-200 cursor-default"
    onclick={handleClose}
    aria-label="Close dialog"
    tabindex="-1"
  ></button>

  <!-- Dialog -->
  <div
    role="dialog"
    aria-labelledby="api-key-reveal-title"
    aria-modal="true"
    tabindex="-1"
    data-testid="api-key-reveal-content"
    use:focusTrap={{ initialFocus: '#api-key-reveal-copy' }}
    class={cn(
      'bg-background fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6 shadow-lg animate-in fade-in-0 zoom-in-95 duration-200',
      className,
    )}
  >
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <h2 id="api-key-reveal-title" class="text-lg font-semibold">Save your API key</h2>
      <button
        type="button"
        data-testid="api-key-reveal-close"
        aria-label="Close dialog"
        class="ring-offset-background focus:ring-ring rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2"
        onclick={handleClose}
      >
        <XIcon class="size-4" aria-hidden="true" />
      </button>
    </div>

    <p class="text-muted-foreground text-sm">
      This key is shown only once. Copy and store it securely — it can't be retrieved later.
      You can regenerate it from the project's settings if you lose it.
    </p>

    <div
      data-testid="api-key-reveal-value"
      class="bg-muted mt-4 rounded-md p-3 font-mono text-sm break-all"
    >
      {apiKey}
    </div>

    <div class="mt-4 flex justify-end gap-2">
      <Button id="api-key-reveal-copy" data-testid="api-key-reveal-copy" onclick={copyKey}>
        <CopyIcon class="mr-2 size-4" aria-hidden="true" />
        Copy
      </Button>
      <Button variant="outline" onclick={handleClose}>Done</Button>
    </div>
  </div>
{/if}
