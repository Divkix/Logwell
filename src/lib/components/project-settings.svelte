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
import * as Select from './ui/select';
import Separator from './ui/separator/separator.svelte';

interface Props {
  project: Project;
  appUrl?: string | null;
  open: boolean;
  onClose?: () => void;
  onRename?: (name: string) => Promise<void>;
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
  onRename,
  onRegenerate,
  onDelete,
  triggerElement = null,
  class: className,
}: Props = $props();

let showRegenerateConfirm = $state(false);
let showDeleteConfirm = $state(false);
let deleteConfirmInput = $state('');
let previouslyFocusedElement: HTMLElement | null = $state(null);
let selectedExample = $state<string>('curl');

// Project name editing state
let isEditingName = $state(false);
let editedName = $state('');
let nameError = $state('');
let isSaving = $state(false);

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

// Reset edited name when project changes
$effect(() => {
  editedName = project.name;
});

const isDeleteConfirmValid = $derived(deleteConfirmInput === project.name);

// Dynamic base URL: use ORIGIN env var if set, otherwise fall back to current origin
const baseUrl = $derived(
  appUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com'),
);

// Simple API curl command
const simpleCurlCommand = $derived(
  `curl -X POST ${baseUrl}/v1/ingest \\
  -H "Authorization: Bearer ${project.apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"level": "info", "message": "Hello from my app"}'`,
);

// SDK example generator (takes package name for npm vs JSR)
const sdkExample = (packageName: string) =>
  `import { Logwell } from '${packageName}';

const logger = new Logwell({
  apiKey: '${project.apiKey}',
  endpoint: '${baseUrl}',
});

logger.info('Hello from my app');`;

const typescriptExample = $derived(sdkExample('logwell'));
const jsrExample = $derived(sdkExample('@divkix/logwell'));

async function copyApiKey() {
  try {
    await navigator.clipboard.writeText(project.apiKey);
    toastSuccess('API key copied to clipboard');
    announceToScreenReader('API key copied to clipboard');
  } catch {
    toastError('Failed to copy to clipboard');
  }
}

// Get current example code based on selection
const currentExampleCode = $derived(
  selectedExample === 'curl'
    ? simpleCurlCommand
    : selectedExample === 'jsr'
      ? jsrExample
      : typescriptExample,
);
const currentExampleInstall = $derived(
  selectedExample === 'typescript'
    ? 'npm install logwell'
    : selectedExample === 'jsr'
      ? 'deno add jsr:@divkix/logwell'
      : null,
);

async function copyExampleCode() {
  try {
    await navigator.clipboard.writeText(currentExampleCode);
    toastSuccess('Code copied to clipboard');
    announceToScreenReader('Code copied to clipboard');
  } catch {
    toastError('Failed to copy to clipboard');
  }
}

async function copyProjectName() {
  try {
    await navigator.clipboard.writeText(project.name);
    toastSuccess('Project name copied to clipboard');
    announceToScreenReader('Project name copied to clipboard');
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
    } else if (isEditingName) {
      handleCancelEdit();
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

function handleCancelEdit() {
  isEditingName = false;
  editedName = project.name;
  nameError = '';
}

async function handleSaveName() {
  if (!onRename) return;

  nameError = '';
  const trimmedName = editedName.trim();

  // Client-side validation
  if (!trimmedName) {
    nameError = 'Project name cannot be empty';
    return;
  }

  if (trimmedName.length > 50) {
    nameError = 'Project name cannot exceed 50 characters';
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
    nameError = 'Project name must contain only alphanumeric characters, hyphens, and underscores';
    return;
  }

  isSaving = true;
  try {
    await onRename(trimmedName);
    isEditingName = false;
    nameError = '';
    toastSuccess('Project name updated successfully');
    announceToScreenReader('Project name updated successfully');
  } catch (error) {
    if (error instanceof Error) {
      nameError = error.message;
    } else {
      nameError = 'Failed to update project name';
    }
  } finally {
    isSaving = false;
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
        <!-- Project Name Section -->
        <div>
          <span class="text-muted-foreground text-sm font-medium">Project Name</span>
          {#if isEditingName}
            <div class="mt-2 space-y-2">
              <input
                type="text"
                data-testid="project-name-input"
                class="bg-background border-input w-full rounded-md border px-3 py-2 text-sm"
                bind:value={editedName}
                aria-invalid={!!nameError}
              />
              {#if nameError}
                <p class="text-destructive text-sm" data-testid="name-error">{nameError}</p>
              {/if}
              <div class="flex gap-2">
                <Button size="sm" onclick={handleSaveName} disabled={isSaving} data-testid="save-name-button">
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
                <Button variant="outline" size="sm" onclick={handleCancelEdit} data-testid="cancel-edit-button">Cancel</Button>
              </div>
            </div>
          {:else}
            <div class="mt-2 flex items-center gap-2">
              <span class="font-medium" data-testid="project-name-display">{project.name}</span>
              <Button variant="ghost" size="sm" onclick={() => { isEditingName = true; editedName = project.name; }} data-testid="edit-name-button">
                Edit
              </Button>
            </div>
          {/if}
        </div>

        <Separator />

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

        <!-- Quick Start Section -->
        <div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground text-sm font-medium">Quick Start</span>
            <Select.Root type="single" bind:value={selectedExample}>
              <Select.Trigger class="w-[140px] h-8" data-testid="example-selector">
                <span class="capitalize">{selectedExample}</span>
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="curl" data-testid="example-option-curl">curl</Select.Item>
                <Select.Item value="typescript" data-testid="example-option-typescript">TypeScript</Select.Item>
                <Select.Item value="jsr" data-testid="example-option-jsr">JSR (Deno)</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
          <pre
            data-testid="example-code"
            aria-label="API usage example"
            class="bg-muted mt-2 rounded-md p-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap"
          >{currentExampleCode}</pre>
          <div class="mt-2 flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              data-testid="copy-example-button"
              aria-label="Copy code to clipboard"
              onclick={copyExampleCode}
            >
              <CopyIcon class="mr-2 size-4" aria-hidden="true" />
              Copy
            </Button>
            {#if currentExampleInstall}
              <span class="text-muted-foreground text-xs">
                Install: <code class="bg-muted rounded px-1">{currentExampleInstall}</code>
              </span>
            {/if}
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
              This action cannot be undone. Type
              <span class="inline-flex items-center gap-1">
                <code class="bg-muted rounded px-1 font-mono">{project.name}</code>
                <button
                  type="button"
                  data-testid="copy-project-name-button"
                  aria-label="Copy project name to clipboard"
                  class="text-muted-foreground hover:text-foreground p-0.5 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded"
                  onclick={copyProjectName}
                >
                  <CopyIcon class="size-3" aria-hidden="true" />
                </button>
              </span>
              to confirm.
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
