import { json, type Handle, type HandleServerError } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { building } from "$app/environment";
import { auth, initAuth } from "$lib/server/auth";
import { db } from "$lib/server/db";
import { handleError as buildErrorResponse } from "$lib/server/error-handler";
import { startCleanupScheduler, stopCleanupScheduler } from "$lib/server/jobs/cleanup-scheduler";
import { checkCsrfOrigin } from "$lib/server/utils/csrf";
import { checkRateLimit, LOGIN_RPM } from "$lib/server/utils/rate-limit";

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    await initAuth();

    startCleanupScheduler();

    initialized = true;
  }
}

function gracefulShutdown(signal: string) {
  console.log(`[shutdown] ${signal} received`);
  stopCleanupScheduler();
  setTimeout(() => process.exit(0), 5000);
}
process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => gracefulShutdown("SIGINT"));

export const handle: Handle = async ({ event, resolve }) => {
  if (building) {
    return resolve(event);
  }

  await ensureInitialized();

  event.locals.db = db;

  const pathname = event.url.pathname;

  if (event.request.method === "POST" && pathname.startsWith("/api/auth/sign-in")) {
    const csrfError = checkCsrfOrigin(event);
    if (csrfError) return csrfError;

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

  if (
    pathname.startsWith("/v1/") ||
    pathname === "/api/health" ||
    pathname.startsWith("/static/")
  ) {
    return resolve(event);
  }

  const session = await auth.api.getSession({
    headers: event.request.headers,
  });

  if (session) {
    event.locals.session = session.session;
    event.locals.user = session.user;
  }

  if (event.request.method === "POST" && pathname.startsWith("/api/auth/sign-up")) {
    return json(
      { error: "sign_up_disabled", message: "Account sign-up is disabled." },
      { status: 403 },
    );
  }

  if (
    pathname.startsWith("/api/auth/") &&
    !["GET", "HEAD", "OPTIONS"].includes(event.request.method)
  ) {
    const csrfError = checkCsrfOrigin(event);
    if (csrfError) return csrfError;
  }

  return svelteKitHandler({ event, resolve, auth, building });
};

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
