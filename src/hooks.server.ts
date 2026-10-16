import type { Handle, HandleServerError } from "@sveltejs/kit/hooks";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { building } from "$app/env";
import { auth, CLIENT_IP_HEADER, initAuth } from "#lib/server/auth.js";
import { env, warnIfOriginUnset } from "#lib/server/config/env.js";
import { closeDb, db } from "#lib/server/db/index.js";
import { handleError as buildErrorResponse, reportFatalError } from "#lib/server/error-handler.js";
import { startCleanupScheduler, stopCleanupScheduler } from "#lib/server/jobs/cleanup-scheduler.js";
import { checkCsrfOrigin } from "#lib/server/utils/csrf.js";
import { loginAccountKey } from "#lib/server/utils/login-account.js";
import { securityHeadersFor, withSecurityHeaders } from "#lib/server/utils/security-headers.js";
import {
  clientNetworkKey,
  ingestIpLimiter,
  knownLoginNetworks,
  LOGIN_ACCOUNT_RPM,
  LOGIN_RPM,
  loginAccountLimiter,
  loginIpLimiter,
} from "#lib/server/utils/rate-limit.js";

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    await initAuth();

    warnIfOriginUnset();

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

// Uncaught exceptions and unhandled rejections get an error ID and context in the log. A monitor,
// unlike an `uncaughtException`/`unhandledRejection` listener, leaves Node's crash (exit 1) intact.
process.on("uncaughtExceptionMonitor", (error, origin) => void reportFatalError(error, origin));

function tooManyLogins(): Response {
  return Response.json(
    { error: "rate_limited", message: "Too many login attempts. Retry in 60 seconds." },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}

const app: Handle = async ({ event, resolve }) => {
  if (building) {
    return resolve(event);
  }

  await ensureInitialized();

  event.locals.db = db;

  const pathname = event.url.pathname;

  // Set for a sign-in that passed both login limits. A token taken from the account's bucket
  // is refunded unless the attempt fails on credentials, so only failed guesses count against
  // an account.
  let signIn: { account: string; network: string; charged: boolean } | null = null;

  if (event.request.method === "POST" && pathname.startsWith("/api/auth/sign-in")) {
    const csrfError = checkCsrfOrigin(event);

    if (csrfError) return csrfError;

    const network = clientNetworkKey(event.getClientAddress());

    if (!loginIpLimiter.take(network, LOGIN_RPM)) return tooManyLogins();

    const account = await loginAccountKey(db, event.request, pathname);
    const charged = loginAccountLimiter.take(account, LOGIN_ACCOUNT_RPM);

    // Failures from other networks can drain the account's bucket; they must not lock the
    // owner out of a network they have signed in from before.
    if (!charged && !knownLoginNetworks.has(account, network)) return tooManyLogins();

    signIn = { account, network, charged };
  }

  if (pathname.startsWith("/v1/")) {
    // Pre-auth throttle: every request with a fresh random key costs a DB lookup in
    // validateApiKey, so the per-IP bucket drains before the per-project one (ingest.ts).
    const network = clientNetworkKey(event.getClientAddress());

    if (!ingestIpLimiter.take(network, env.RATE_LIMIT_INGEST_IP_RPM)) {
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

  // Overwritten, never appended: a client-supplied value must not reach better-auth.
  event.request.headers.set(CLIENT_IP_HEADER, event.getClientAddress());

  const response = await svelteKitHandler({ event, resolve, auth, building });

  if (signIn) {
    // better-auth answers bad credentials with 401; anything else was not a password guess.
    if (signIn.charged && response.status !== 401) {
      loginAccountLimiter.refund(signIn.account, LOGIN_ACCOUNT_RPM);
    }

    // Only a sign-in resolved to an existing account ("user:<id>", see loginAccountKey) is
    // remembered; a 2xx means better-auth accepted its password.
    if (response.ok && signIn.account.startsWith("user:")) {
      knownLoginNetworks.remember(signIn.account, signIn.network);
    }
  }

  return response;
};

// Wraps `app` rather than going through Kit's sequence(), so its early returns (429s, 403s, CSRF
// rejections) carry the headers too, and the hook stays callable outside Kit's request store.
export const handle: Handle = async (input) =>
  withSecurityHeaders(await app(input), securityHeadersFor(env.ORIGIN));

export const handleError: HandleServerError = (caught) => {
  // Kit 3 also routes `error(status, message)` throws through this hook. Their body is
  // already client-safe, so returning nothing keeps it — as Kit 2 did by never calling here.
  if (caught.kind === "app") return;

  const { event } = caught;

  const { status, message } =
    caught.kind === "unknown" ? { status: 500, message: "Internal Error" } : caught.error;

  return buildErrorResponse({
    error: caught.kind === "unknown" ? caught.error : message,
    url: event.url.href,
    method: event.request.method,
    route: event.route?.id ?? "unknown",
    status,
    message,
  });
};
