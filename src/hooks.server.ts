import type { Handle, HandleServerError } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { building } from "$app/environment";
import { auth, initAuth } from "#lib/server/auth.js";
import { env } from "#lib/server/config/env.js";
import { closeDb, db } from "#lib/server/db/index.js";
import { handleError as buildErrorResponse } from "#lib/server/error-handler.js";
import { startCleanupScheduler, stopCleanupScheduler } from "#lib/server/jobs/cleanup-scheduler.js";
import { checkCsrfOrigin } from "#lib/server/utils/csrf.js";
import { checkRateLimit, LOGIN_RPM } from "#lib/server/utils/rate-limit.js";

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    await initAuth();

    startCleanupScheduler();

    initialized = true;
  }
}

async function gracefulShutdown(reason: string): Promise<void> {
  console.log(`[shutdown] ${reason} received`);
  stopCleanupScheduler();
  // Fallback only, past closeDb's 5s drain; unref'd so it never delays a clean exit.
  setTimeout(() => process.exit(0), 6000).unref();

  try {
    await closeDb();
  } catch (error) {
    console.error("[shutdown] failed to close database pool", error);
  }
}

// adapter-node emits this on SIGTERM/SIGINT once the HTTP server has closed — open SSE streams
// hold that until SHUTDOWN_TIMEOUT, when the adapter force-closes them.
process.once("sveltekit:shutdown", (reason: string) => void gracefulShutdown(reason));

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

  if (pathname.startsWith("/v1/")) {
    // Pre-auth throttle: every request with a fresh random key costs a DB lookup in
    // validateApiKey, so the per-IP bucket drains before the per-project one (ingest.ts).
    if (!checkRateLimit(`ingest-ip:${event.getClientAddress()}`, env.RATE_LIMIT_INGEST_IP_RPM)) {
      return Response.json(
        { error: "rate_limited", message: "Rate limit exceeded. Retry in 60 seconds." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    return resolve(event);
  }

  if (pathname === "/api/health" || pathname.startsWith("/static/")) {
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
    return Response.json(
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
