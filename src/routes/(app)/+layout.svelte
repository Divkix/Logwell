<script lang="ts">
import LogOut from '@lucide/svelte/icons/log-out';
import { goto } from '$app/navigation';
import { authClient } from '$lib/auth-client';
import Logo from '$lib/components/logo.svelte';
import ThemeToggle from '$lib/components/theme-toggle.svelte';
import { Button } from '$lib/components/ui/button/index.js';
import { toastError } from '$lib/utils/toast';

const { data, children } = $props();

let isLoggingOut = $state(false);

async function handleLogout() {
  isLoggingOut = true;
  try {
    await authClient.signOut();
    await goto('/login');
  } catch (error) {
    toastError('Logout failed. Please try again.');
    console.error('Logout failed:', error);
    isLoggingOut = false;
  }
}
</script>

<div class="flex min-h-screen flex-col">
  <header class="border-b bg-background">
    <div class="container mx-auto flex h-14 items-center justify-between px-4">
      <a href="/" class="flex items-center gap-2 font-semibold text-lg">
        <Logo size={24} />
        <span>Logwell</span>
      </a>

      <div class="flex items-center gap-2 sm:gap-4">
        <span class="hidden sm:inline text-sm text-muted-foreground">
          {data.user.name || data.user.email}
        </span>

        <ThemeToggle />

        <Button
          variant="ghost"
          size="sm"
          onclick={handleLogout}
          disabled={isLoggingOut}
          aria-label="Logout"
        >
          <LogOut class="size-4 sm:mr-2" />
          <span class="hidden sm:inline">Logout</span>
        </Button>
      </div>
    </div>
  </header>

  <main class="container mx-auto flex-1 px-4 py-6 pb-20 sm:pb-6">
    {@render children()}
  </main>
</div>
