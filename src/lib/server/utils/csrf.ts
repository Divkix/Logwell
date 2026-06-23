import type { RequestEvent } from "@sveltejs/kit";
import { apiError } from "./api-error";

/**
 * Checks Origin and Referer headers for CSRF protection on state-changing requests.
 *
 * Policy:
 * - GET/HEAD/OPTIONS are always allowed (no state change)
 * - If Origin header is present, it must match the site's origin exactly
 * - If Referer header is present, it must start with the site's origin + '/'
 * - If BOTH are absent on a state-changing request, the request is rejected (403)
 *
 * This protects against cross-origin POST/PATCH/DELETE on cookie-authenticated routes.
 * Every caller of this function is a cookie-authenticated route; the bearer /v1 ingest
 * routes do NOT call this function and are unaffected (SDK/curl legitimately omit headers).
 *
 * Note: the previous allow-on-absence policy has been tightened. Requests with neither
 * Origin nor Referer are now rejected to close the ambient-cookie CSRF soft spot.
 * Same-origin browser requests always send at least one of these headers per spec.
 */
export function checkCsrfOrigin(event: RequestEvent): Response | null {
  const method = event.request.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const expectedOrigin = event.url.origin;

  const origin = event.request.headers.get("Origin");
  if (origin && origin !== expectedOrigin) {
    return apiError(403, "csrf_error", "Invalid Origin header");
  }

  const referer = event.request.headers.get("Referer");
  if (referer && !referer.startsWith(`${expectedOrigin}/`)) {
    return apiError(403, "csrf_error", "Invalid Referer header");
  }

  // Neither Origin nor Referer present on a state-changing request.
  // Every caller of this function is cookie-authenticated, so a header-less
  // cross-origin request must not be trusted. (Bearer /v1 ingest routes do not
  // call this function and are unaffected.)
  if (!origin && !referer) {
    return apiError(403, "csrf_error", "Missing Origin and Referer headers");
  }

  return null;
}
