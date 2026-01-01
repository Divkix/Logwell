<script lang="ts">
import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
import HomeIcon from '@lucide/svelte/icons/home';
import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
import { page } from '$app/stores';
import { Button } from '$lib/components/ui/button/index.js';

const errorCode = $derived($page.status);
const errorMessage = $derived($page.error?.message || 'An unexpected error occurred');
const errorId = $derived(($page.error as { id?: string })?.id);

function reload() {
  window.location.reload();
}

const errorTitles: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

const errorTitle = $derived(errorTitles[errorCode] || 'Error');
</script>

<div class="min-h-screen flex items-center justify-center bg-background p-4">
  <div class="text-center max-w-md space-y-6">
    <!-- Error Icon -->
    <div class="flex justify-center">
      <div class="rounded-full bg-destructive/10 p-4">
        <AlertTriangleIcon class="size-12 text-destructive" />
      </div>
    </div>

    <!-- Error Code and Title -->
    <div class="space-y-2">
      <h1 class="text-6xl font-bold text-foreground">{errorCode}</h1>
      <h2 class="text-xl font-semibold text-muted-foreground">{errorTitle}</h2>
    </div>

    <!-- Error Message -->
    <p class="text-muted-foreground">{errorMessage}</p>

    <!-- Error ID for tracking (only for 5xx errors) -->
    {#if errorId && errorCode >= 500}
      <p class="text-xs text-muted-foreground/60 font-mono">
        Error ID: {errorId}
      </p>
    {/if}

    <!-- Actions -->
    <div class="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
      <Button onclick={reload} variant="outline">
        <RefreshCwIcon class="mr-2 size-4" />
        Try Again
      </Button>
      <Button href="/">
        <HomeIcon class="mr-2 size-4" />
        Go Home
      </Button>
    </div>
  </div>
</div>
