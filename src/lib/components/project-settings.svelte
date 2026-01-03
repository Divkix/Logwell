<script lang="ts">
import CopyIcon from '@lucide/svelte/icons/copy';
import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
import Trash2Icon from '@lucide/svelte/icons/trash-2';
import XIcon from '@lucide/svelte/icons/x';
import type { Project } from '$lib/server/db/schema';
import { cn } from '$lib/utils';
import { announceToScreenReader, focusTrap } from '$lib/utils/focus-trap';
import { toastError, toastSuccess } from '$lib/utils/toast';
import Button from './ui/button/button.svelte';
import Separator from './ui/separator/separator.svelte';

interface Props {
  project: Project;
  appUrl?: string | null;
  open: boolean;
  onClose?: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
  triggerElement?: HTMLElement | null;
  class?: string;
}

const {
  project,
  appUrl = null,
  open,
  onClose,
  onRegenerate,
  onDelete,
  triggerElement = null,
  class: className,
}: Props = $props();

let showRegenerateConfirm = $state(false);
let showDeleteConfirm = $state(false);
let deleteConfirmInput = $state('');
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

const isDeleteConfirmValid = $derived(deleteConfirmInput === project.name);

// Dynamic base URL: use ORIGIN env var if set, otherwise fall back to current origin
const baseUrl = $derived(
  appUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'),
);

const otlpSamplePayload = {
  resourceLogs: [
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'my-service' } }],
      },
      scopeLogs: [
        {
          scope: { name: 'sv-logger' },
          logRecords: [
            {
              severityNumber: 9,
              severityText: 'INFO',
              body: { stringValue: 'Hello!' },
            },
          ],
        },
      ],
    },
  ],
};

// Full curl command for easy copy-paste
const curlCommand = $derived(
  `curl -X POST ${baseUrl}/v1/logs \\
  -H "Authorization: Bearer ${project.apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(otlpSamplePayload)}'`,
);

async function copyApiKey() {
  try {
    await navigator.clipboard.writeText(project.apiKey);
    toastSuccess('API key copied to clipboard');
    announceToScreenReader('API key copied to clipboard');
  } catch {
    toastError('Failed to copy to clipboard');
  }
}

async function copyCurlCommand() {
  try {
    await navigator.clipboard.writeText(curlCommand);
    toastSuccess('Curl command copied to clipboard');
    announceToScreenReader('Curl command copied to clipboard');
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
    aria-labelledby="project-settings-title"
    aria-modal="true"
    tabindex="-1"
    data-testid="modal-content"
    use:focusTrap={{ initialFocus: '[data-testid="close-button"]' }}
    class={cn(
      'bg-background fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6 shadow-lg animate-in fade-in-0 zoom-in-95 duration-200',
      className,
    )}
  >
      <!-- Header -->
      <div class="mb-4 flex items-center justify-between">
        <h2 id="project-settings-title" class="text-lg font-semibold">Project Settings</h2>
        <button
          type="button"
          data-testid="close-button"
          aria-label="Close project settings"
          class="ring-offset-background focus:ring-ring rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2"
          onclick={() => onClose?.()}
        >
          <XIcon class="size-4" aria-hidden="true" />
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
              aria-label="Copy API key to clipboard"
              onclick={copyApiKey}
            >
              <CopyIcon class="mr-2 size-4" aria-hidden="true" />
              Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="regenerate-button"
              aria-label="Regenerate API key"
              onclick={handleRegenerateClick}
            >
              <RefreshCwIcon class="mr-2 size-4" aria-hidden="true" />
              Regenerate
            </Button>
          </div>
        </div>

        <!-- Usage Example Section -->
        <div>
          <span class="text-muted-foreground text-sm font-medium">OTLP/HTTP Example</span>
          <pre
            data-testid="curl-example"
            aria-label="API usage example"
            class="bg-muted mt-2 rounded-md p-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap"
          >{curlCommand}</pre>
          <div class="mt-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="copy-curl-button"
              aria-label="Copy curl command to clipboard"
              onclick={copyCurlCommand}
            >
              <CopyIcon class="mr-2 size-4" aria-hidden="true" />
              Copy Command
            </Button>
          </div>
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
            aria-label="Delete project"
            onclick={handleDeleteClick}
          >
            <Trash2Icon class="mr-2 size-4" aria-hidden="true" />
            Delete Project
          </Button>
        </div>
      </div>

      <!-- Regenerate Confirmation Dialog -->
      {#if showRegenerateConfirm}
        <div
          class="fixed inset-0 z-60 flex items-center justify-center bg-black/50"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <div
            data-testid="regenerate-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="regenerate-dialog-title"
            aria-describedby="regenerate-dialog-description"
            tabindex="-1"
            class="bg-background w-full max-w-md rounded-lg border p-6 shadow-lg"
            use:focusTrap={{ initialFocus: '[data-testid="cancel-regenerate-button"]' }}
          >
            <h3 id="regenerate-dialog-title" class="text-lg font-semibold">Regenerate API Key?</h3>
            <p id="regenerate-dialog-description" class="text-muted-foreground mt-2 text-sm">
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
        <div
          class="fixed inset-0 z-60 flex items-center justify-center bg-black/50"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <div
            data-testid="delete-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-description"
            tabindex="-1"
            class="bg-background w-full max-w-md rounded-lg border p-6 shadow-lg"
            use:focusTrap={{ initialFocus: '[data-testid="delete-confirm-input"]' }}
          >
            <h3 id="delete-dialog-title" class="text-lg font-semibold text-destructive">Delete Project?</h3>
            <p id="delete-dialog-description" class="text-muted-foreground mt-2 text-sm" data-testid="delete-instruction">
              This action cannot be undone. Type <code class="bg-muted rounded px-1 font-mono"
                >{project.name}</code
              > to confirm.
            </p>
            <label for="delete-confirm-input" class="sr-only">Type project name to confirm deletion</label>
            <input
              id="delete-confirm-input"
              type="text"
              data-testid="delete-confirm-input"
              class="bg-background border-input mt-3 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Type project name to confirm"
              aria-describedby="delete-dialog-description"
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
{/if}
