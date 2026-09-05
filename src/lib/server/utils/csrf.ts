import type { RequestEvent } from "@sveltejs/kit";
import { apiError } from "./api-error";

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

  if (!origin && !referer) {
    return apiError(403, "csrf_error", "Missing Origin and Referer headers");
  }

  return null;
}
