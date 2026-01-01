<script lang="ts">
import LogOut from '@lucide/svelte/icons/log-out';
import { goto } from '$app/navigation';
import { authClient } from '$lib/auth-client';
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
      <!-- Logo/Title -->
      <a href="/" class="flex items-center gap-2 font-semibold text-lg">
        <span class="text-primary">sv-logger</span>
      </a>

      <!-- Right side: User info, Theme toggle, Logout -->
      <div class="flex items-center gap-4">
        <!-- User info -->
        <span class="text-sm text-muted-foreground">
          {data.user.name || data.user.email}
        </span>

        <!-- Theme toggle -->
        <ThemeToggle />

        <!-- Logout button -->
        <Button
          variant="ghost"
          size="sm"
          onclick={handleLogout}
          disabled={isLoggingOut}
          aria-label="Logout"
        >
          <LogOut class="mr-2 size-4" />
          Logout
        </Button>
      </div>
    </div>
  </header>

  <main class="container mx-auto flex-1 px-4 py-6">
    {@render children()}
  </main>
</div>
