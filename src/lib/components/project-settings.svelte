<script lang="ts">
import CopyIcon from '@lucide/svelte/icons/copy';
import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
import Trash2Icon from '@lucide/svelte/icons/trash-2';
import XIcon from '@lucide/svelte/icons/x';
import type { Project } from '$lib/server/db/schema';
import { cn } from '$lib/utils';
import { toastError, toastSuccess } from '$lib/utils/toast';
import Button from './ui/button/button.svelte';
import Separator from './ui/separator/separator.svelte';

interface Props {
  project: Project;
  open: boolean;
  onClose?: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
  class?: string;
}

const { project, open, onClose, onRegenerate, onDelete, class: className }: Props = $props();

let showRegenerateConfirm = $state(false);
let showDeleteConfirm = $state(false);
let deleteConfirmInput = $state('');

const isDeleteConfirmValid = $derived(deleteConfirmInput === project.name);

const truncatedApiKey = $derived(
  project.apiKey.length > 20
    ? `${project.apiKey.substring(0, 12)}...${project.apiKey.slice(-8)}`
    : project.apiKey,
);

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess('API key copied to clipboard');
  } catch {
    toastError('Failed to copy to clipboard');
  }
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (showRegenerateConfirm) {
      showRegenerateConfirm = false;
    } else if (showDeleteConfirm) {
      showDeleteConfirm = false;
      deleteConfirmInput = '';
    } else {
      onClose?.();
    }
  }
}

function handleOverlayClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    onClose?.();
  }
}

function handleRegenerateClick() {
  showRegenerateConfirm = true;
}

function handleRegenerateConfirm() {
  onRegenerate?.();
  showRegenerateConfirm = false;
}

function handleRegenerateCancel() {
  showRegenerateConfirm = false;
}

function handleDeleteClick() {
  showDeleteConfirm = true;
}

function handleDeleteConfirm() {
  if (isDeleteConfirmValid) {
    onDelete?.();
    showDeleteConfirm = false;
    deleteConfirmInput = '';
  }
}

function handleDeleteCancel() {
  showDeleteConfirm = false;
  deleteConfirmInput = '';
}
</script>

<svelte:document onkeydown={handleKeyDown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    data-testid="modal-overlay"
    class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-200"
    onclick={handleOverlayClick}
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      role="dialog"
      aria-labelledby="project-settings-title"
      aria-modal="true"
      tabindex="0"
      data-testid="modal-content"
      class={cn(
        'bg-background fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6 shadow-lg animate-in fade-in-0 zoom-in-95 duration-200',
        className,
      )}
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="mb-4 flex items-center justify-between">
        <h2 id="project-settings-title" class="text-lg font-semibold">Project Settings</h2>
        <button
          type="button"
          data-testid="close-button"
          aria-label="Close"
          class="ring-offset-background focus:ring-ring rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2"
          onclick={() => onClose?.()}
        >
          <XIcon class="size-4" />
        </button>
      </div>

      <!-- Content -->
      <div class="space-y-6 overflow-y-auto max-h-[70vh]">
        <!-- API Key Section -->
        <div>
          <span class="text-muted-foreground text-sm font-medium">API Key</span>
          <div
            data-testid="api-key-display"
            class="bg-muted mt-2 rounded-md p-3 font-mono text-sm break-all"
          >
            {project.apiKey}
          </div>
          <div class="mt-2 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="copy-api-key-button"
              aria-label="Copy API key"
              onclick={() => copyToClipboard(project.apiKey)}
            >
              <CopyIcon class="mr-2 size-4" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="regenerate-button"
              onclick={handleRegenerateClick}
            >
              <RefreshCwIcon class="mr-2 size-4" />
              Regenerate
            </Button>
          </div>
        </div>

        <!-- Usage Example Section -->
        <div>
          <span class="text-muted-foreground text-sm font-medium">Usage Example</span>
          <pre
            data-testid="curl-example"
            class="bg-muted mt-2 rounded-md p-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap"
          >curl -X POST https://your-domain.com/api/v1/logs \
  -H "Authorization: Bearer {truncatedApiKey}" \
  -H "Content-Type: application/json" \
  -d '{JSON.stringify({ level: 'info', message: 'Hello!' })}'</pre>
        </div>

        <Separator />

        <!-- Danger Zone -->
        <div>
          <span class="text-destructive text-sm font-medium">Danger Zone</span>
          <p class="text-muted-foreground mt-1 text-sm">
            This will permanently delete the project and all its logs.
          </p>
          <Button
            variant="destructive"
            size="sm"
            class="mt-3"
            data-testid="delete-project-button"
            onclick={handleDeleteClick}
          >
            <Trash2Icon class="mr-2 size-4" />
            Delete Project
          </Button>
        </div>
      </div>

      <!-- Regenerate Confirmation Dialog -->
      {#if showRegenerateConfirm}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div
          data-testid="regenerate-confirm-dialog"
          class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onclick={(e) => e.stopPropagation()}
        >
          <div class="bg-background w-full max-w-md rounded-lg border p-6 shadow-lg">
            <h3 class="text-lg font-semibold">Regenerate API Key?</h3>
            <p class="text-muted-foreground mt-2 text-sm">
              This will invalidate the current API key immediately. Any applications using the old
              key will stop working.
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="cancel-regenerate-button"
                onclick={handleRegenerateCancel}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                data-testid="confirm-regenerate-button"
                onclick={handleRegenerateConfirm}
              >
                Regenerate
              </Button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Delete Confirmation Dialog -->
      {#if showDeleteConfirm}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div
          data-testid="delete-confirm-dialog"
          class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onclick={(e) => e.stopPropagation()}
        >
          <div class="bg-background w-full max-w-md rounded-lg border p-6 shadow-lg">
            <h3 class="text-lg font-semibold text-destructive">Delete Project?</h3>
            <p class="text-muted-foreground mt-2 text-sm" data-testid="delete-instruction">
              This action cannot be undone. Type <code class="bg-muted rounded px-1 font-mono"
                >{project.name}</code
              > to confirm.
            </p>
            <input
              type="text"
              data-testid="delete-confirm-input"
              class="bg-background border-input mt-3 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Type project name to confirm"
              bind:value={deleteConfirmInput}
            />
            <div class="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="cancel-delete-button"
                onclick={handleDeleteCancel}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                data-testid="confirm-delete-button"
                disabled={!isDeleteConfirmValid}
                onclick={handleDeleteConfirm}
              >
                Delete Project
              </Button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
