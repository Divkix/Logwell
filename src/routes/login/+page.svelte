<script lang="ts">
import { authClient } from '$lib/auth-client';
import { Button } from '$lib/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '$lib/components/ui/card';
import { Input } from '$lib/components/ui/input';

// Form state
let email = $state('');
let password = $state('');
let error = $state('');
let isLoading = $state(false);

// Validation state
let emailError = $state('');
let passwordError = $state('');

// Reference to password input for auto-focus
let passwordInput: HTMLInputElement | null = $state(null);

// Focus password field on mount
$effect(() => {
  if (passwordInput) {
    passwordInput.focus();
  }
});

/**
 * Validates email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates form fields
 * Returns true if valid, false otherwise
 */
function validateForm(): boolean {
  let isValid = true;
  emailError = '';
  passwordError = '';

  // Check email
  if (!email.trim()) {
    emailError = 'Email is required';
    isValid = false;
  } else if (!isValidEmail(email)) {
    emailError = 'Invalid email format';
    isValid = false;
  }

  // Check password
  if (!password) {
    passwordError = 'Password is required';
    isValid = false;
  }

  return isValid;
}

/**
 * Handle form submission
 */
async function handleSubmit(event: Event) {
  event.preventDefault();

  // Clear previous errors
  error = '';

  // Validate form
  if (!validateForm()) {
    return;
  }

  isLoading = true;

  try {
    const { data, error: signInError } = await authClient.signIn.email(
      {
        email: email.trim(),
        password,
      },
      {
        onSuccess: () => {
          // Use hard redirect to ensure server sees the session cookie
          // Client-side navigation (goto) doesn't reliably send cookies on first request
          window.location.href = '/';
        },
        onError: (ctx) => {
          // Handle error from better-auth
          error = ctx.error?.message || 'Invalid credentials';
          isLoading = false;
        },
      },
    );

    if (signInError) {
      // Show error message
      error = signInError.message || 'Invalid credentials';
      isLoading = false;
      return;
    }

    // If we have data but onSuccess didn't fire, redirect manually
    if (data?.user) {
      window.location.href = '/';
    }
  } catch (err) {
    // Handle unexpected errors
    error = 'An unexpected error occurred. Please try again.';
    isLoading = false;
  }
}

/**
 * Handle Enter key press in form fields
 */
function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    handleSubmit(event);
  }
}
</script>

<svelte:head>
  <title>Sign In - sv-logger</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <Card class="w-full max-w-sm">
    <CardHeader class="text-center">
      <h1 class="text-2xl font-semibold leading-none">Sign In</h1>
      <CardDescription>Enter your credentials to access sv-logger</CardDescription>
    </CardHeader>
    <CardContent>
      <form onsubmit={(e) => { e.preventDefault(); handleSubmit(e); }} novalidate class="flex flex-col gap-4">
        <!-- Email field -->
        <div class="flex flex-col gap-2">
          <label for="email" class="text-sm font-medium">Email</label>
          <Input
            id="email"
            type="email"
            placeholder="admin@example.com"
            bind:value={email}
            disabled={isLoading}
            aria-invalid={!!emailError}
            aria-describedby={emailError ? 'email-error' : undefined}
            onkeydown={handleKeyDown}
          />
          {#if emailError}
            <p id="email-error" class="text-destructive text-sm">{emailError}</p>
          {/if}
        </div>

        <!-- Password field -->
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
            onkeydown={handleKeyDown}
          />
          {#if passwordError}
            <p id="password-error" class="text-destructive text-sm">{passwordError}</p>
          {/if}
        </div>

        <!-- Error message -->
        {#if error}
          <p class="text-destructive text-sm text-center">{error}</p>
        {/if}

        <!-- Submit button -->
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
