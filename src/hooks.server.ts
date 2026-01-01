import type { Handle, HandleServerError } from '@sveltejs/kit';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import { auth, initAuth } from '$lib/server/auth';
import { createErrorHandler } from '$lib/server/error-handler';

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

/**
 * Global error handler for server-side errors
 * - Logs errors with context for debugging
 * - Returns sanitized error messages to clients
 * - Generates unique error IDs for tracking
 */
const errorHandler = createErrorHandler();

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  return errorHandler({
    error,
    url: event.url.href,
    method: event.request.method,
    route: event.route?.id ?? 'unknown',
    status,
    message,
  });
};
