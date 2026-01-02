import { createAuthClient } from 'better-auth/svelte';

/**
 * Client-side auth helper for better-auth
 * Provides type-safe authentication methods for use in components
 *
 * Note: baseURL is omitted to use relative paths, which automatically
 * works with whatever port the server is running on
 */
export const authClient = createAuthClient();
