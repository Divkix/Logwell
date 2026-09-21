import type { RequestEvent } from "@sveltejs/kit";
import { env } from "$lib/server/config/env";
import { apiError } from "./api-error";

let warnedUnsetOrigin = false;

/**
 * Authority of an Origin/Referer value, lowercased, or null when the value is not a
 * URL — `new URL` throws on non-URL values such as the "null" origin a sandboxed
 * context sends, and the Host header keeps the client's casing while `URL#host` does not.
 */
function headerHost(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

export function checkCsrfOrigin(event: RequestEvent): Response | null {
  const method = event.request.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const origin = event.request.headers.get("Origin");
  const referer = event.request.headers.get("Referer");

  // With ORIGIN set the adapter pins event.url.origin to it, so the exact-origin
  // comparison stays authoritative. Without it the adapter synthesizes `https://<Host>`
  // (get_origin defaults the protocol to https), which would reject every mutation on a
  // plain-HTTP deployment; only the protocol is unreliable, so compare the authority.
  const expectedOrigin = env.ORIGIN ? event.url.origin : null;
  const expectedHost = event.url.host.toLowerCase();

  if (expectedOrigin === null && !warnedUnsetOrigin) {
    warnedUnsetOrigin = true;
    console.warn(
      "[csrf] ORIGIN is not set: same-site requests are matched against the request Host. " +
        "Set ORIGIN to the public URL when running behind a reverse proxy.",
    );
  }

  const sameOrigin = (value: string) =>
    expectedOrigin === null ? headerHost(value) === expectedHost : value === expectedOrigin;
  const sameSite = (value: string) =>
    expectedOrigin === null
      ? headerHost(value) === expectedHost
      : value.startsWith(`${expectedOrigin}/`);

  if (origin && !sameOrigin(origin)) {
    return apiError(403, "csrf_error", "Invalid Origin header");
  }

  if (referer && !sameSite(referer)) {
    return apiError(403, "csrf_error", "Invalid Referer header");
  }

  if (!origin && !referer) {
    return apiError(403, "csrf_error", "Missing Origin and Referer headers");
  }

  return null;
}
