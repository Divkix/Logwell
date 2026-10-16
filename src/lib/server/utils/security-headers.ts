/**
 * Response headers every app response carries. The Content-Security-Policy is not here: Kit
 * emits it for rendered pages (with per-response nonces) from the `csp` option in vite.config.ts.
 */
const BASE_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  // Legacy twin of CSP `frame-ancestors 'none'`, for browsers and proxies that ignore CSP.
  ["X-Frame-Options", "DENY"],
  // Search terms and IDs live in dashboard URLs; never hand them to another origin.
  ["Referrer-Policy", "same-origin"],
];

// One year, without includeSubDomains: Logwell does not own the rest of its domain.
const HSTS: readonly [string, string] = ["Strict-Transport-Security", "max-age=31536000"];

/**
 * The headers for a deployment served at `origin` (the ORIGIN env). HSTS is only sent for an
 * https ORIGIN: over plain HTTP browsers ignore it, and a dev/LAN deploy must stay reachable.
 */
export function securityHeadersFor(origin: string | undefined): Array<readonly [string, string]> {
  return origin?.startsWith("https://")
    ? [...BASE_SECURITY_HEADERS, HSTS]
    : [...BASE_SECURITY_HEADERS];
}

/**
 * Adds `headers` the response does not already set. Responses with immutable headers (such as
 * `Response.redirect`) are copied first, since setting on them throws.
 */
export function withSecurityHeaders(
  response: Response,
  headers: Array<readonly [string, string]>,
): Response {
  const missing = headers.filter(([name]) => !response.headers.has(name));

  if (missing.length === 0) return response;

  try {
    for (const [name, value] of missing) response.headers.set(name, value);

    return response;
  } catch {
    const copy = new Response(response.body, response);

    for (const [name, value] of missing) copy.headers.set(name, value);

    return copy;
  }
}
