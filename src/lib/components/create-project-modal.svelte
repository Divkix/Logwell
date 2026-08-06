<script lang="ts">
import XIcon from '@lucide/svelte/icons/x';
import { projectCreatePayloadSchema } from '$lib/shared/schemas/project';
import { cn } from '$lib/utils';
import { focusTrap } from '$lib/utils/focus-trap';
import Button from './ui/button/button.svelte';
import Input from './ui/input/input.svelte';

interface Props {
  open: boolean;
  onClose?: () => void;
  onCreate?: (name: string) => Promise<void>;
  triggerElement?: HTMLElement | null;
  class?: string;
}

const { open, onClose, onCreate, triggerElement = null, class: className }: Props = $props();

let name = $state('');
let error = $state('');
let isSubmitting = $state(false);
let previouslyFocusedElement: HTMLElement | null = $state(null);

// Store the previously focused element when modal opens
$effect(() => {
  if (open && !previouslyFocusedElement) {
    previouslyFocusedElement = (triggerElement || document.activeElement) as HTMLElement;
  }
});

// Restore focus when modal closes
$effect(() => {
  if (!open && previouslyFocusedElement) {
    previouslyFocusedElement.focus();
    previouslyFocusedElement = null;
  }
});

function reset() {
  name = '';
  error = '';
  isSubmitting = false;
}

function handleClose() {
  reset();
  onClose?.();
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    handleClose();
  }
}

async function handleSubmit(event: Event) {
  event.preventDefault();
  error = '';

  // Validate name against the shared project create schema (single source of
  // truth with POST /api/projects).
  const trimmedName = name.trim();
  const validation = projectCreatePayloadSchema.safeParse({ name: trimmedName });
  if (!validation.success) {
    error = validation.error.issues?.[0]?.message ?? 'Project name is required';
    return;
  }

  isSubmitting = true;
  try {
    await onCreate?.(trimmedName);
    reset();
    onClose?.();
  } catch (err) {
    if (err instanceof Error) {
      error = err.message;
    } else {
      error = 'Failed to create project';
    }
  } finally {
    isSubmitting = false;
  }
}
</script>

<svelte:document onkeydown={handleKeyDown} />

{#if open}
  <!-- Backdrop -->
  <button
    type="button"
    data-testid="modal-overlay"
    class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-200 cursor-default"
    onclick={handleClose}
    aria-label="Close dialog"
    tabindex="-1"
  ></button>

  <!-- Dialog -->
  <div
    role="dialog"
    aria-labelledby="create-project-title"
    aria-modal="true"
    tabindex="-1"
    data-testid="modal-content"
    use:focusTrap={{ initialFocus: '#project-name' }}
    class={cn(
      'bg-background fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6 shadow-lg animate-in fade-in-0 zoom-in-95 duration-200',
      className,
    )}
  >
      <!-- Header -->
      <div class="mb-4 flex items-center justify-between">
        <h2 id="create-project-title" class="text-lg font-semibold">Create Project</h2>
        <button
          type="button"
          data-testid="close-button"
          aria-label="Close create project dialog"
          class="ring-offset-background focus:ring-ring rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2"
          onclick={handleClose}
        >
          <XIcon class="size-4" aria-hidden="true" />
        </button>
      </div>

      <!-- Form -->
      <form onsubmit={handleSubmit} class="space-y-4">
        <div class="space-y-2">
          <label for="project-name" class="text-sm font-medium leading-none">
            Name
          </label>
          <Input
            id="project-name"
            type="text"
            placeholder="my-project"
            bind:value={name}
            disabled={isSubmitting}
            aria-invalid={!!error}
            aria-describedby={error ? 'name-error' : undefined}
          />
          {#if error}
            <p id="name-error" class="text-sm text-destructive" data-testid="error-message">
              {error}
            </p>
          {/if}
        </div>

        <div class="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onclick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {#if isSubmitting}
              Creating...
            {:else}
              Create
            {/if}
          </Button>
        </div>
      </form>
  </div>
{/if}
