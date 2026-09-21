import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { checkCsrfOrigin as CheckCsrfOrigin } from "$lib/server/utils/csrf";

function makeEvent(method: string, url: string, headers: Record<string, string> = {}) {
  const request = new Request(url, { method, headers });
  return {
    request,
    url: new URL(url),
  } as Parameters<typeof CheckCsrfOrigin>[0];
}

/**
 * env.ORIGIN is captured when the module graph is first evaluated, so each stub needs a
 * fresh module instance — a static import could only ever see the process environment.
 */
async function loadCsrf(origin: string | undefined): Promise<typeof CheckCsrfOrigin> {
  vi.stubEnv("ORIGIN", origin);
  vi.resetModules();
  const { checkCsrfOrigin } = await import("$lib/server/utils/csrf");
  return checkCsrfOrigin;
}

// What the bun adapter synthesizes for a plain-HTTP request to localhost:3000 with
// ORIGIN unset: event.url is https://<Host> even though the browser speaks http.
const ADAPTER_URL = "https://localhost:3000/api/projects";
const ADAPTER_HOST = { Host: "localhost:3000" };

describe("checkCsrfOrigin with ORIGIN unset (request-Host fallback)", () => {
  let checkCsrfOrigin: typeof CheckCsrfOrigin;

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    checkCsrfOrigin = await loadCsrf(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // method, headers, allowed
  const cases: Array<[string, Record<string, string>, boolean]> = [
    // Safe methods skip the check entirely.
    ["GET", { Origin: "https://evil.com" }, true],
    ["HEAD", {}, true],
    ["OPTIONS", {}, true],
    // Same host passes via Origin or Referer, whatever protocol the adapter guessed.
    ["POST", { ...ADAPTER_HOST, Origin: "http://localhost:3000" }, true],
    ["POST", { ...ADAPTER_HOST, Referer: "http://localhost:3000/login" }, true],
    ["PATCH", { ...ADAPTER_HOST, Origin: "http://localhost:3000" }, true],
    ["DELETE", { ...ADAPTER_HOST, Origin: "http://localhost:3000" }, true],
    ["POST", { ...ADAPTER_HOST, Origin: "https://localhost:3000" }, true],
    // Cross-host, lookalike host or port, and missing credentials all fail closed.
    ["POST", { ...ADAPTER_HOST, Origin: "https://evil.com" }, false],
    ["POST", { ...ADAPTER_HOST, Referer: "https://evil.com/phishing" }, false],
    ["PATCH", { ...ADAPTER_HOST, Origin: "http://localhost.evil.com" }, false],
    ["POST", { ...ADAPTER_HOST, Referer: "http://localhost.evil.com/" }, false],
    ["POST", { ...ADAPTER_HOST, Origin: "http://localhost:4000" }, false],
    ["POST", { ...ADAPTER_HOST, Origin: "null" }, false],
    ["POST", {}, false],
  ];

  it.each(cases)("%s %j is %s", async (method, headers, allowed) => {
    const result = checkCsrfOrigin(makeEvent(method, ADAPTER_URL, headers));
    if (allowed) {
      expect(result).toBeNull();
    } else {
      expect(result?.status).toBe(403);
      expect((await result!.json()).error).toBe("csrf_error");
    }
  });

  it("warns once that ORIGIN is unset", async () => {
    const sameHost = { ...ADAPTER_HOST, Origin: "http://localhost:3000" };
    checkCsrfOrigin(makeEvent("POST", ADAPTER_URL, sameHost));
    checkCsrfOrigin(makeEvent("POST", ADAPTER_URL, sameHost));

    expect(vi.mocked(console.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]?.[0]).toContain("ORIGIN is not set");
  });
});

describe("checkCsrfOrigin with ORIGIN set (exact origin)", () => {
  const ORIGIN = "https://logs.example.com";
  const URL = `${ORIGIN}/api/projects`;
  let checkCsrfOrigin: typeof CheckCsrfOrigin;

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    checkCsrfOrigin = await loadCsrf(ORIGIN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const cases: Array<[string, Record<string, string>, boolean]> = [
    ["POST", { Origin: ORIGIN }, true],
    ["POST", { Referer: `${ORIGIN}/dashboard` }, true],
    // A same-host request with the wrong protocol or a lookalike host is not the origin.
    ["POST", { Origin: "http://logs.example.com" }, false],
    ["POST", { Origin: "https://logs.example.com.evil.com" }, false],
    ["POST", { Origin: "https://evil.example" }, false],
    ["POST", { Referer: "http://logs.example.com/dashboard" }, false],
    ["POST", {}, false],
  ];

  it.each(cases)("%s %j is %s", async (method, headers, allowed) => {
    const result = checkCsrfOrigin(makeEvent(method, URL, headers));
    if (allowed) {
      expect(result).toBeNull();
    } else {
      expect(result?.status).toBe(403);
      expect((await result!.json()).error).toBe("csrf_error");
    }
  });

  it("does not warn about ORIGIN", async () => {
    checkCsrfOrigin(makeEvent("POST", URL, { Origin: ORIGIN }));
    expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
  });
});
