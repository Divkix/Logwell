import { describe, expect, it } from "vite-plus/test";
import { securityHeadersFor, withSecurityHeaders } from "./security-headers";

describe("securityHeadersFor", () => {
  it.each([
    [undefined, false],
    ["http://logs.internal:3000", false],
    ["https://logs.example.com", true],
  ])("ORIGIN %s → HSTS %s", (origin, hsts) => {
    const names = securityHeadersFor(origin).map(([name]) => name);

    expect(names).toEqual(
      expect.arrayContaining(["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"]),
    );
    expect(names.includes("Strict-Transport-Security")).toBe(hsts);
  });
});

describe("withSecurityHeaders", () => {
  const headers = securityHeadersFor("https://logs.example.com");

  it("keeps a value the response already chose", () => {
    const response = withSecurityHeaders(
      new Response("ok", { headers: { "Referrer-Policy": "no-referrer" } }),
      headers,
    );

    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("copies a response whose headers are immutable instead of throwing", () => {
    const redirect = Response.redirect("https://logs.example.com/login", 303);

    const response = withSecurityHeaders(redirect, headers);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("https://logs.example.com/login");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
  });
});
