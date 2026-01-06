<script lang="ts">
import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
import CopyIcon from '@lucide/svelte/icons/copy';
import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
import Trash2Icon from '@lucide/svelte/icons/trash-2';
import { goto } from '$app/navigation';
import Button from '$lib/components/ui/button/button.svelte';
import * as Select from '$lib/components/ui/select';
import Separator from '$lib/components/ui/separator/separator.svelte';
import { announceToScreenReader } from '$lib/utils/focus-trap';
import { toastError, toastSuccess } from '$lib/utils/toast';

interface Props {
  data: {
    project: {
      id: string;
      name: string;
      apiKey: string;
      retentionDays: number | null;
      createdAt: string | null;
      updatedAt: string | null;
    };
    stats: {
      totalLogs: number;
      oldestLogDate: string | null;
    };
    systemDefault: {
      retentionDays: number;
    };
  };
}

const { data }: Props = $props();

// Project data state (for updates after API calls)
// These intentionally capture initial values - we update them locally after API calls
// svelte-ignore state_referenced_locally
let projectName = $state(data.project.name);
// svelte-ignore state_referenced_locally
let projectApiKey = $state(data.project.apiKey);
// svelte-ignore state_referenced_locally
let projectRetentionDays = $state(data.project.retentionDays);

// UI state
let showRegenerateConfirm = $state(false);
let showDeleteConfirm = $state(false);
let deleteConfirmInput = $state('');
let selectedExample = $state<string>('curl');

// Project name editing state
let isEditingName = $state(false);
let editedName = $state('');
let nameError = $state('');
let isSaving = $state(false);

// Retention editing state
let isUpdatingRetention = $state(false);

// Retention options (derived to properly reference data.systemDefault)
const retentionOptions = $derived([
  { value: 'system', label: `System Default (${data.systemDefault.retentionDays} days)` },
  { value: '0', label: 'Never delete' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '365 days' },
]);

// Current retention value for select
const currentRetentionValue = $derived(
  projectRetentionDays === null ? 'system' : String(projectRetentionDays),
);

// Effective retention for display
const effectiveRetention = $derived(
  projectRetentionDays === null ? data.systemDefault.retentionDays : projectRetentionDays,
);

const isDeleteConfirmValid = $derived(deleteConfirmInput === projectName);

// Dynamic base URL
const baseUrl = $derived(
  typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com',
);

// Code examples
const simpleCurlCommand = $derived(
  `curl -X POST ${baseUrl}/v1/ingest \\
  -H "Authorization: Bearer ${projectApiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"level": "info", "message": "Hello from my app"}'`,
);

const sdkExample = (packageName: string) =>
  `import { Logwell } from '${packageName}';

const logger = new Logwell({
  apiKey: '${projectApiKey}',
  endpoint: '${baseUrl}',
});

logger.info('Hello from my app');`;

const typescriptExample = $derived(sdkExample('logwell'));
const jsrExample = $derived(sdkExample('@divkix/logwell'));

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

async function copyToClipboard(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess(message);
    announceToScreenReader(message);
  } catch {
    toastError('Failed to copy to clipboard');
  }
}

async function handleSaveName() {
  nameError = '';
  const trimmedName = editedName.trim();

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
    const response = await fetch(`/api/projects/${data.project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to update project name');
    }

    projectName = trimmedName;
    isEditingName = false;
    toastSuccess('Project name updated successfully');
    announceToScreenReader('Project name updated successfully');
  } catch (error) {
    nameError = error instanceof Error ? error.message : 'Failed to update project name';
  } finally {
    isSaving = false;
  }
}

function handleCancelEdit() {
  isEditingName = false;
  editedName = projectName;
  nameError = '';
}

async function handleRetentionChange(value: string | undefined) {
  if (!value) return;

  const newRetention = value === 'system' ? null : Number(value);
  if (newRetention === projectRetentionDays) return;

  isUpdatingRetention = true;
  try {
    const response = await fetch(`/api/projects/${data.project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays: newRetention }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to update retention');
    }

    projectRetentionDays = newRetention;
    toastSuccess('Log retention updated successfully');
    announceToScreenReader('Log retention updated successfully');
  } catch (error) {
    toastError(error instanceof Error ? error.message : 'Failed to update retention');
  } finally {
    isUpdatingRetention = false;
  }
}

async function handleRegenerateApiKey() {
  try {
    const response = await fetch(`/api/projects/${data.project.id}/regenerate`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to regenerate API key');
    }

    const result = await response.json();
    projectApiKey = result.apiKey;
    showRegenerateConfirm = false;
    toastSuccess('API key regenerated successfully');
    announceToScreenReader('API key regenerated successfully');
  } catch (error) {
    console.error('Failed to regenerate API key:', error);
    toastError('Failed to regenerate API key');
  }
}

async function handleDeleteProject() {
  if (!isDeleteConfirmValid) return;

  try {
    const response = await fetch(`/api/projects/${data.project.id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete project');
    }

    toastSuccess('Project deleted successfully');
    goto('/');
  } catch (error) {
    console.error('Failed to delete project:', error);
    toastError('Failed to delete project');
  }
}

function formatDate(isoDate: string | null): string {
  if (!isoDate) return 'N/A';
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
</script>

<svelte:head>
  <title>Settings - {projectName} | Logwell</title>
</svelte:head>

<div class="container mx-auto max-w-5xl px-4 py-8">
  <!-- Header with back button -->
  <div class="mb-8">
    <a
      href="/projects/{data.project.id}"
      class="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm transition-colors"
    >
      <ArrowLeftIcon class="size-4" />
      Back to project
    </a>
    <h1 class="mt-4 text-2xl font-bold">Project Settings</h1>
    <p class="text-muted-foreground mt-1">Manage your project configuration and API access.</p>
  </div>

  <div class="space-y-8">
    <!-- Settings Grid: 2x2 on desktop, 1-column on mobile -->
    <div data-testid="settings-grid" class="grid gap-6 sm:grid-cols-2">
      <!-- Row 1: General + API Key -->
      <!-- General Section -->
      <section class="bg-card rounded-lg border p-6">
      <h2 class="text-lg font-semibold">General</h2>

      <div class="mt-4 space-y-4">
        <div>
          <span id="project-name-label" class="text-muted-foreground text-sm font-medium">Project Name</span>
          {#if isEditingName}
            <div class="mt-2 space-y-2">
              <input
                type="text"
                data-testid="project-name-input"
                class="bg-background border-input w-full rounded-md border px-3 py-2 text-sm"
                bind:value={editedName}
                aria-invalid={!!nameError}
                aria-labelledby="project-name-label"
              />
              {#if nameError}
                <p class="text-destructive text-sm" data-testid="name-error">{nameError}</p>
              {/if}
              <div class="flex gap-2">
                <Button size="sm" onclick={handleSaveName} disabled={isSaving} data-testid="save-name-button">
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
                <Button variant="outline" size="sm" onclick={handleCancelEdit} data-testid="cancel-edit-button">
                  Cancel
                </Button>
              </div>
            </div>
          {:else}
            <div class="mt-2 flex items-center gap-2">
              <span class="font-medium" data-testid="project-name-display">{projectName}</span>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => { isEditingName = true; editedName = projectName; }}
                data-testid="edit-name-button"
              >
                Edit
              </Button>
            </div>
          {/if}
        </div>

        <div>
          <span class="text-muted-foreground text-sm font-medium">Created</span>
          <p class="mt-1">{formatDate(data.project.createdAt)}</p>
        </div>
      </div>
    </section>

    <!-- API Key Section -->
    <section class="bg-card rounded-lg border p-6">
      <h2 class="text-lg font-semibold">API Key</h2>
      <p class="text-muted-foreground mt-1 text-sm">
        Use this key to authenticate your log ingestion requests.
      </p>

      <div
        data-testid="api-key-display"
        class="bg-muted mt-4 rounded-md p-3 font-mono text-sm break-all"
      >
        {projectApiKey}
      </div>

      <div class="mt-4 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          data-testid="copy-api-key-button"
          aria-label="Copy API key to clipboard"
          onclick={() => copyToClipboard(projectApiKey, 'API key copied to clipboard')}
        >
          <CopyIcon class="mr-2 size-4" aria-hidden="true" />
          Copy
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="regenerate-button"
          aria-label="Regenerate API key"
          onclick={() => (showRegenerateConfirm = true)}
        >
          <RefreshCwIcon class="mr-2 size-4" aria-hidden="true" />
          Regenerate
        </Button>
      </div>
    </section>

      <!-- Row 2: Quick Start + Log Retention -->
      <!-- Quick Start Section -->
      <section class="bg-card rounded-lg border p-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold">Quick Start</h2>
          <p class="text-muted-foreground mt-1 text-sm">
            Get started with sending logs to your project.
          </p>
        </div>
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
        class="bg-muted mt-4 rounded-md p-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap"
      >{currentExampleCode}</pre>

      <div class="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          data-testid="copy-example-button"
          aria-label="Copy code to clipboard"
          onclick={() => copyToClipboard(currentExampleCode, 'Code copied to clipboard')}
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
    </section>

    <!-- Log Retention Section -->
    <section class="bg-card rounded-lg border p-6">
      <h2 class="text-lg font-semibold">Log Retention</h2>
      <p class="text-muted-foreground mt-1 text-sm">
        Configure how long logs are kept before automatic deletion.
      </p>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label for="retention-select" class="text-muted-foreground text-sm font-medium">
            Retention Period
          </label>
          <Select.Root
            type="single"
            value={currentRetentionValue}
            onValueChange={handleRetentionChange}
            disabled={isUpdatingRetention}
          >
            <Select.Trigger
              id="retention-select"
              class="mt-2 w-full"
              data-testid="retention-selector"
            >
              <span>
                {retentionOptions.find((o) => o.value === currentRetentionValue)?.label}
              </span>
            </Select.Trigger>
            <Select.Content>
              {#each retentionOptions as option}
                <Select.Item value={option.value} data-testid="retention-option-{option.value}">
                  {option.label}
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
          {#if isUpdatingRetention}
            <p class="text-muted-foreground mt-1 text-xs">Updating...</p>
          {/if}
        </div>

        <div>
          <span class="text-muted-foreground text-sm font-medium">Log Statistics</span>
          <div class="bg-muted mt-2 rounded-md p-3 text-sm">
            <div class="flex justify-between">
              <span class="text-muted-foreground">Total logs:</span>
              <span class="font-medium">{data.stats.totalLogs.toLocaleString()}</span>
            </div>
            <div class="mt-1 flex justify-between">
              <span class="text-muted-foreground">Oldest log:</span>
              <span class="font-medium">{formatDate(data.stats.oldestLogDate)}</span>
            </div>
            <Separator class="my-2" />
            <div class="flex justify-between">
              <span class="text-muted-foreground">Effective retention:</span>
              <span class="font-medium">
                {effectiveRetention === 0 ? 'Never delete' : `${effectiveRetention} days`}
              </span>
            </div>
          </div>
        </div>
        </div>
      </section>
    </div>

    <!-- Danger Zone: Full-width, outside grid -->
    <section data-testid="danger-zone" class="rounded-lg border border-destructive/50 p-6">
      <h2 class="text-destructive text-lg font-semibold">Danger Zone</h2>
      <p class="text-muted-foreground mt-1 text-sm">
        Permanently delete this project and all associated logs. This action cannot be undone.
      </p>
      <Button
        variant="destructive"
        size="sm"
        class="mt-4"
        data-testid="delete-project-button"
        aria-label="Delete project"
        onclick={() => (showDeleteConfirm = true)}
      >
        <Trash2Icon class="mr-2 size-4" aria-hidden="true" />
        Delete Project
      </Button>
    </section>
  </div>
</div>

<!-- Regenerate Confirmation Dialog -->
{#if showRegenerateConfirm}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
    <div
      data-testid="regenerate-confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="regenerate-dialog-title"
      aria-describedby="regenerate-dialog-description"
      class="bg-background mx-4 w-full max-w-md rounded-lg border p-6 shadow-lg"
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
          onclick={() => (showRegenerateConfirm = false)}
        >
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          data-testid="confirm-regenerate-button"
          onclick={handleRegenerateApiKey}
        >
          Regenerate
        </Button>
      </div>
    </div>
  </div>
{/if}

<!-- Delete Confirmation Dialog -->
{#if showDeleteConfirm}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
    <div
      data-testid="delete-confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-description"
      class="bg-background mx-4 w-full max-w-md rounded-lg border p-6 shadow-lg"
    >
      <h3 id="delete-dialog-title" class="text-destructive text-lg font-semibold">Delete Project?</h3>
      <p id="delete-dialog-description" class="text-muted-foreground mt-2 text-sm" data-testid="delete-instruction">
        This action cannot be undone. Type
        <span class="inline-flex items-center gap-1">
          <code class="bg-muted rounded px-1 font-mono">{projectName}</code>
          <button
            type="button"
            data-testid="copy-project-name-button"
            aria-label="Copy project name to clipboard"
            class="text-muted-foreground hover:text-foreground p-0.5 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded"
            onclick={() => copyToClipboard(projectName, 'Project name copied to clipboard')}
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
          onclick={() => { showDeleteConfirm = false; deleteConfirmInput = ''; }}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          data-testid="confirm-delete-button"
          disabled={!isDeleteConfirmValid}
          onclick={handleDeleteProject}
        >
          Delete Project
        </Button>
      </div>
    </div>
  </div>
{/if}
