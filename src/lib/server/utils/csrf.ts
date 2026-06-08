import type { RequestEvent } from "@sveltejs/kit";

/**
 * Checks Origin and Referer headers for CSRF protection on state-changing requests.
 *
 * Policy:
 * - GET/HEAD/OPTIONS are always allowed (no state change)
 * - If Origin header is present, it must match the site's origin exactly
 * - If Referer header is present, it must start with the site's origin + '/'
 * - If both are absent, the request is allowed (may be same-origin from some clients)
 *
 * This protects against cross-origin POST/PATCH/DELETE while avoiding false
 * positives for legitimate same-origin requests that don't send Origin.
 *
 * Note: requests with neither Origin nor Referer are allowed. This is intentional for
 * API clients (e.g. SDKs, curl) that don't send these headers. Cross-origin browser
 * requests always include Origin per spec. For additional protection on browser-only
 * routes, consider requiring Origin when a session cookie is present.
 */
export function checkCsrfOrigin(event: RequestEvent): Response | null {
  const method = event.request.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const expectedOrigin = event.url.origin;

  const origin = event.request.headers.get("Origin");
  if (origin && origin !== expectedOrigin) {
    return new Response(JSON.stringify({ error: "csrf_error", message: "Invalid Origin header" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const referer = event.request.headers.get("Referer");
  if (referer && !referer.startsWith(`${expectedOrigin}/`)) {
    return new Response(
      JSON.stringify({ error: "csrf_error", message: "Invalid Referer header" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return null;
}
