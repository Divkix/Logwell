<script lang="ts">
import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
import CopyIcon from '@lucide/svelte/icons/copy';
import XIcon from '@lucide/svelte/icons/x';
import type { Log } from '$lib/server/db/schema';
import { cn } from '$lib/utils';
import { announceToScreenReader, focusTrap } from '$lib/utils/focus-trap';
import { formatFullDate } from '$lib/utils/format';
import LevelBadge from './level-badge.svelte';

interface Props {
  log: Log;
  open: boolean;
  onClose?: () => void;
  onViewIncident?: (incidentId: string) => void;
  triggerElement?: HTMLElement | null;
  class?: string;
}

const {
  log,
  open,
  onClose,
  onViewIncident,
  triggerElement = null,
  class: className,
}: Props = $props();

const formattedTimestamp = $derived(log.timestamp ? formatFullDate(log.timestamp) : null);

const formattedMetadata = $derived(log.metadata ? JSON.stringify(log.metadata, null, 2) : null);

const sourceInfo = $derived(
  log.sourceFile ? (log.lineNumber ? `${log.sourceFile}:${log.lineNumber}` : log.sourceFile) : null,
);

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

async function copyToClipboard(text: string, description: string) {
  await navigator.clipboard.writeText(text);
  announceToScreenReader(`${description} copied to clipboard`);
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    onClose?.();
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
    aria-labelledby="log-detail-title"
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
        <h2 id="log-detail-title" class="text-lg font-semibold">Log Details</h2>
        <button
          type="button"
          data-testid="close-button"
          aria-label="Close log details"
          class="ring-offset-background focus:ring-ring rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2"
          onclick={() => onClose?.()}
        >
          <XIcon class="size-4" aria-hidden="true" />
        </button>
      </div>

      <!-- Content -->
      <div class="space-y-4 overflow-y-auto max-h-[60vh]">
        <!-- ID -->
        <div class="flex items-center justify-between">
          <div>
            <span class="text-muted-foreground text-sm">ID</span>
            <p class="font-mono text-sm">{log.id}</p>
          </div>
          <button
            type="button"
            data-testid="copy-id-button"
            aria-label="Copy log ID to clipboard"
            class="text-muted-foreground hover:text-foreground p-1 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
            onclick={() => copyToClipboard(log.id, 'Log ID')}
          >
            <CopyIcon class="size-4" aria-hidden="true" />
          </button>
        </div>

        <!-- Level -->
        <div>
          <span class="text-muted-foreground text-sm">Level</span>
          <div class="mt-1">
            <LevelBadge level={log.level} />
          </div>
        </div>

        <!-- Timestamp -->
        <div>
          <span class="text-muted-foreground text-sm">Timestamp</span>
          <p class="font-mono text-sm">
            {formattedTimestamp ?? 'N/A'}
          </p>
        </div>

        <!-- Message -->
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1">
            <span class="text-muted-foreground text-sm">Message</span>
            <p class="text-sm whitespace-pre-wrap wrap-break-word">{log.message}</p>
          </div>
          <button
            type="button"
            data-testid="copy-message-button"
            aria-label="Copy message to clipboard"
            class="text-muted-foreground hover:text-foreground p-1 shrink-0 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
            onclick={() => copyToClipboard(log.message, 'Message')}
          >
            <CopyIcon class="size-4" aria-hidden="true" />
          </button>
        </div>

        <!-- Source -->
        <div>
          <span class="text-muted-foreground text-sm">Source</span>
          <p class="font-mono text-sm">{sourceInfo ?? 'N/A'}</p>
        </div>

        <!-- Request ID -->
        <div class="flex items-center justify-between">
          <div>
            <span class="text-muted-foreground text-sm">Request ID</span>
            <p class="font-mono text-sm">{log.requestId ?? 'N/A'}</p>
          </div>
          {#if log.requestId}
            <button
              type="button"
              data-testid="copy-request-id-button"
              aria-label="Copy request ID to clipboard"
              class="text-muted-foreground hover:text-foreground p-1 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
              onclick={() => copyToClipboard(log.requestId!, 'Request ID')}
            >
              <CopyIcon class="size-4" aria-hidden="true" />
            </button>
          {/if}
        </div>

        {#if log.incidentId}
          <div class="rounded-md border p-3">
            <p class="text-sm font-medium">Linked Incident</p>
            <p class="text-xs font-mono text-muted-foreground mb-2">{log.incidentId}</p>
            {#if onViewIncident}
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted/50"
                onclick={() => onViewIncident(log.incidentId!)}
              >
                View Incident Timeline
                <ArrowRightIcon class="size-3" />
              </button>
            {/if}
          </div>
        {/if}

        <!-- User ID -->
        <div>
          <span class="text-muted-foreground text-sm">User ID</span>
          <p class="font-mono text-sm">{log.userId ?? 'N/A'}</p>
        </div>

        <!-- IP Address -->
        <div>
          <span class="text-muted-foreground text-sm">IP Address</span>
          <p class="font-mono text-sm">{log.ipAddress ?? 'N/A'}</p>
        </div>

        <!-- Metadata -->
        <div data-testid="metadata-section" aria-label="Log metadata">
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground text-sm">Metadata</span>
            {#if log.metadata}
              <button
                type="button"
                data-testid="copy-metadata-button"
                aria-label="Copy metadata to clipboard"
                class="text-muted-foreground hover:text-foreground p-1 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
                onclick={() => copyToClipboard(formattedMetadata!, 'Metadata')}
              >
                <CopyIcon class="size-4" aria-hidden="true" />
              </button>
            {/if}
          </div>
          {#if formattedMetadata}
            <pre
              data-testid="log-metadata"
              class="bg-muted mt-1 rounded-md p-3 text-sm font-mono overflow-x-auto"
              aria-label="Log metadata JSON"
            >{formattedMetadata}</pre>
          {:else}
            <p class="text-sm">N/A</p>
          {/if}
        </div>
      </div>
  </div>
{/if}
