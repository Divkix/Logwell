<script lang="ts">
import { goto, invalidateAll } from '$app/navigation';
import { authClient } from '$lib/auth-client';
import Logo from '$lib/components/logo.svelte';
import { Button } from '$lib/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
import { Input } from '$lib/components/ui/input';

let username = $state('');
let password = $state('');
let error = $state('');
let isLoading = $state(false);

let usernameError = $state('');
let passwordError = $state('');

let passwordInput: HTMLInputElement | null = $state(null);

$effect(() => {
  if (passwordInput) {
    passwordInput.focus();
  }
});

function validateForm(): boolean {
  let isValid = true;
  usernameError = '';
  passwordError = '';

  if (!username.trim()) {
    usernameError = 'Username is required';
    isValid = false;
  }

  if (!password) {
    passwordError = 'Password is required';
    isValid = false;
  }

  return isValid;
}

async function handleSubmit(event: Event) {
  event.preventDefault();

  error = '';

  if (!validateForm()) {
    return;
  }

  isLoading = true;

  try {
    const { data, error: signInError } = await authClient.signIn.username(
      {
        username: username.trim(),
        password,
      },
      {
        onSuccess: async () => {
          await invalidateAll();
          await goto('/');
        },
        onError: (ctx) => {
          error = ctx.error?.message || 'Invalid credentials';
        },
      },
    );

    if (signInError) {
      error = signInError.message || 'Invalid credentials';
      return;
    }

    if (data?.user) {
      await invalidateAll();
      await goto('/');
    }
  } catch (err) {
    error = 'An unexpected error occurred. Please try again.';
  } finally {
    isLoading = false;
  }
}
</script>

<svelte:head>
  <title>Sign In - Logwell</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <Card class="w-full max-w-sm">
    <CardHeader class="text-center">
      <div class="flex justify-center mb-4">
        <Logo size={56} />
      </div>
      <h1 class="text-2xl font-semibold leading-none">Sign In</h1>
      <CardDescription>Enter your credentials to access Logwell</CardDescription>
    </CardHeader>
    <CardContent>
      <form onsubmit={(e) => { e.preventDefault(); handleSubmit(e); }} novalidate class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <label for="username" class="text-sm font-medium">Username</label>
          <Input
            id="username"
            type="text"
            placeholder="admin"
            bind:value={username}
            disabled={isLoading}
            aria-invalid={!!usernameError}
            aria-describedby={usernameError ? 'username-error' : undefined}
          />
          {#if usernameError}
            <p id="username-error" class="text-destructive text-sm">{usernameError}</p>
          {/if}
        </div>

        <div class="flex flex-col gap-2">
          <label for="password" class="text-sm font-medium">Password</label>
          <Input
            id="password"
            type="password"
            placeholder="Enter your password"
            bind:value={password}
            bind:ref={passwordInput}
            disabled={isLoading}
            aria-invalid={!!passwordError}
            aria-describedby={passwordError ? 'password-error' : undefined}
          />
          {#if passwordError}
            <p id="password-error" class="text-destructive text-sm">{passwordError}</p>
          {/if}
        </div>

        {#if error}
          <p class="text-destructive text-sm text-center">{error}</p>
        {/if}

        <Button type="submit" class="w-full" disabled={isLoading}>
          {#if isLoading}
            <span class="flex items-center gap-2">
              <svg
                class="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Signing in...
            </span>
          {:else}
            Sign In
          {/if}
        </Button>
      </form>
    </CardContent>
  </Card>
</div>
