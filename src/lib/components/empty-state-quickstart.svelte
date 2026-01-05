<script lang="ts">
import CopyIcon from '@lucide/svelte/icons/copy';
import { cn } from '$lib/utils';
import { announceToScreenReader } from '$lib/utils/focus-trap';
import { toastError, toastSuccess } from '$lib/utils/toast';
import Button from './ui/button/button.svelte';
import * as Select from './ui/select';

interface Props {
  apiKey: string;
  baseUrl: string;
  class?: string;
}

const { apiKey, baseUrl, class: className }: Props = $props();

let selectedExample = $state<string>('curl');

const simpleCurlCommand = $derived(
  `curl -X POST ${baseUrl}/v1/ingest \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"level": "info", "message": "Hello!"}'`,
);

const typescriptExample = $derived(
  `import { Logwell } from 'logwell';

const logger = new Logwell({
  apiKey: '${apiKey}',
  endpoint: '${baseUrl}',
});

logger.info('Hello!');`,
);

const jsrExample = $derived(
  `import { Logwell } from '@divkix/logwell';

const logger = new Logwell({
  apiKey: '${apiKey}',
  endpoint: '${baseUrl}',
});

logger.info('Hello!');`,
);

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

async function copyCode() {
  try {
    await navigator.clipboard.writeText(currentExampleCode);
    toastSuccess('Code copied to clipboard');
    announceToScreenReader('Code copied to clipboard');
  } catch {
    toastError('Failed to copy to clipboard');
  }
}
</script>

<div class={cn('text-center py-12', className)} data-testid="empty-state-quickstart">
  <h3 class="text-lg font-medium mb-2">No logs yet</h3>
  <p class="text-muted-foreground mb-6">Send your first log to get started</p>

  <div class="max-w-lg mx-auto text-left">
    <div class="flex items-center justify-between mb-2">
      <span class="text-sm font-medium">Quick Start</span>
      <Select.Root type="single" bind:value={selectedExample}>
        <Select.Trigger class="w-[140px] h-8" data-testid="empty-state-example-selector">
          <span class="capitalize">{selectedExample}</span>
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="curl">curl</Select.Item>
          <Select.Item value="typescript">TypeScript</Select.Item>
          <Select.Item value="jsr">JSR (Deno)</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>

    <pre
      data-testid="empty-state-example-code"
      class="bg-muted rounded-md p-3 text-sm font-mono text-left overflow-x-auto whitespace-pre-wrap"
    >{currentExampleCode}</pre>

    <div class="mt-2 flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        data-testid="empty-state-copy-button"
        onclick={copyCode}
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
</div>
