import type { Handle, HandleServerError } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { building } from "$app/environment";
import { auth, initAuth } from "$lib/server/auth";
import { db } from "$lib/server/db";
import { handleError as buildErrorResponse } from "$lib/server/error-handler";
import { startCleanupScheduler, stopCleanupScheduler } from "$lib/server/jobs/cleanup-scheduler";
import { checkRateLimit, LOGIN_RPM } from "$lib/server/utils/rate-limit";

// Initialize on server startup
let initialized = false;

/**
 * Ensures auth is initialized before handling requests.
 * Starts cleanup scheduler after auth initialization.
 */
async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    // Initialize auth
    await initAuth();

    // Start log cleanup scheduler after initialization
    startCleanupScheduler();

    initialized = true;
  }
}

// Graceful shutdown
function gracefulShutdown(signal: string) {
  console.log(`[shutdown] ${signal} received`);
  stopCleanupScheduler();
  // Give in-flight requests ~5s then exit
  setTimeout(() => process.exit(0), 5000);
}
process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => gracefulShutdown("SIGINT"));

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

  await ensureInitialized();

  // Inject the DB on every route, including the fast-path routes below.
  // Test injection seam — tests override this with a PGlite client via locals.db.
  event.locals.db = db;

  const pathname = event.url.pathname;

  // Brute-force protection: rate limit login attempts per client IP.
  if (event.request.method === "POST" && pathname.startsWith("/api/auth/sign-in")) {
    if (!checkRateLimit(`login:${event.getClientAddress()}`, LOGIN_RPM)) {
      return new Response(
        JSON.stringify({
          error: "rate_limited",
          message: "Too many login attempts. Retry in 60 seconds.",
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "60" },
        },
      );
    }
  }

  // Skip session lookup for paths that never need auth
  if (
    pathname.startsWith("/v1/") ||
    pathname === "/api/health" ||
    pathname.startsWith("/static/")
  ) {
    return resolve(event);
  }

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
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  return buildErrorResponse({
    error,
    url: event.url.href,
    method: event.request.method,
    route: event.route?.id ?? "unknown",
    status,
    message,
  });
};
