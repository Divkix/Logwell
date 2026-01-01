import type { Handle } from '@sveltejs/kit';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import { auth, initAuth } from '$lib/server/auth';

// Initialize auth on server startup
let authInitialized = false;

/**
 * Ensures auth is initialized before handling requests
 */
async function ensureAuthInitialized(): Promise<void> {
  if (!authInitialized) {
    await initAuth();
    authInitialized = true;
  }
}

/**
 * Combined SvelteKit handle hook for better-auth
 * - Populates event.locals with session/user data
 * - Routes /api/auth/* to better-auth handler
 */
export const handle: Handle = async ({ event, resolve }) => {
  // Skip auth during build
  if (building) {
    return resolve(event);
  }

  await ensureAuthInitialized();

  // Fetch current session from Better Auth
  const session = await auth.api.getSession({
    headers: event.request.headers,
  });

  // Make session and user available on server
  if (session) {
    event.locals.session = session.session;
    event.locals.user = session.user;
  }

  // Use better-auth's SvelteKit handler for proper routing
  return svelteKitHandler({ event, resolve, auth, building });
};
