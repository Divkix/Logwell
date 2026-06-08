import { describe, expect, it } from "vite-plus/test";
import { checkCsrfOrigin } from "$lib/server/utils/csrf";

/**
 * Creates a minimal mock RequestEvent for testing checkCsrfOrigin.
 */
function makeEvent(method: string, url: string, headers: Record<string, string> = {}) {
  const request = new Request(url, { method, headers });
  return {
    request,
    url: new URL(url),
  } as Parameters<typeof checkCsrfOrigin>[0];
}

describe("checkCsrfOrigin", () => {
  describe("safe methods (always allowed)", () => {
    it("allows GET requests regardless of Origin", () => {
      const event = makeEvent("GET", "http://localhost/api/projects", {
        Origin: "https://evil.com",
      });
      expect(checkCsrfOrigin(event)).toBeNull();
    });

    it("allows HEAD requests", () => {
      const event = makeEvent("HEAD", "http://localhost/api/projects");
      expect(checkCsrfOrigin(event)).toBeNull();
    });

    it("allows OPTIONS requests", () => {
      const event = makeEvent("OPTIONS", "http://localhost/api/projects");
      expect(checkCsrfOrigin(event)).toBeNull();
    });
  });

  describe("same-origin requests", () => {
    it("allows POST with matching Origin", () => {
      const event = makeEvent("POST", "http://localhost/api/projects", {
        Origin: "http://localhost",
      });
      expect(checkCsrfOrigin(event)).toBeNull();
    });

    it("allows POST with matching Referer", () => {
      const event = makeEvent("POST", "http://localhost/api/projects", {
        Referer: "http://localhost/projects",
      });
      expect(checkCsrfOrigin(event)).toBeNull();
    });

    it("allows POST with no Origin and no Referer (intentional policy for API clients)", () => {
      const event = makeEvent("POST", "http://localhost/api/projects");
      // Per policy: requests with neither header are allowed (API clients, curl)
      expect(checkCsrfOrigin(event)).toBeNull();
    });

    it("allows PATCH with matching Origin", () => {
      const event = makeEvent("PATCH", "http://localhost/api/projects/123", {
        Origin: "http://localhost",
      });
      expect(checkCsrfOrigin(event)).toBeNull();
    });

    it("allows DELETE with matching Origin", () => {
      const event = makeEvent("DELETE", "http://localhost/api/projects/123", {
        Origin: "http://localhost",
      });
      expect(checkCsrfOrigin(event)).toBeNull();
    });
  });

  describe("cross-origin requests (rejected)", () => {
    it("rejects POST with mismatched Origin", () => {
      const event = makeEvent("POST", "http://localhost/api/projects", {
        Origin: "https://evil.com",
      });
      const result = checkCsrfOrigin(event);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it("rejects POST with mismatched Referer", () => {
      const event = makeEvent("POST", "http://localhost/api/projects", {
        Referer: "https://evil.com/phishing",
      });
      const result = checkCsrfOrigin(event);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it("rejects PATCH with mismatched Origin", () => {
      const event = makeEvent("PATCH", "http://localhost/api/projects/123", {
        Origin: "https://attacker.example",
      });
      const result = checkCsrfOrigin(event);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it("returns csrf_error in response body for mismatched Origin", async () => {
      const event = makeEvent("POST", "http://localhost/api/projects", {
        Origin: "https://evil.com",
      });
      const result = checkCsrfOrigin(event);
      expect(result).not.toBeNull();
      const body = await result!.json();
      expect(body.error).toBe("csrf_error");
    });

    it("returns csrf_error in response body for mismatched Referer", async () => {
      const event = makeEvent("POST", "http://localhost/api/projects", {
        Referer: "https://evil.com/attack",
      });
      const result = checkCsrfOrigin(event);
      expect(result).not.toBeNull();
      const body = await result!.json();
      expect(body.error).toBe("csrf_error");
    });

    it("rejects Referer that does not start with origin + slash", () => {
      // e.g. referer starts with http://localhost but not http://localhost/
      // This case would only apply if Referer were exactly the origin without a slash.
      // The check is startsWith(`${expectedOrigin}/`) so origin-only Referer is rejected.
      const event = makeEvent("POST", "http://localhost/api/projects", {
        Referer: "http://localhost.evil.com/",
      });
      const result = checkCsrfOrigin(event);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });
  });
});
