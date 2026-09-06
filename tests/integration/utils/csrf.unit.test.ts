import { describe, expect, it } from "vite-plus/test";
import { checkCsrfOrigin } from "$lib/server/utils/csrf";

function makeEvent(method: string, url: string, headers: Record<string, string> = {}) {
  const request = new Request(url, { method, headers });
  return {
    request,
    url: new URL(url),
  } as Parameters<typeof checkCsrfOrigin>[0];
}

const TEST_URL = "http://localhost/api/projects";

// method, headers, allowed
const cases: Array<[string, Record<string, string>, boolean]> = [
  // Safe methods skip the check entirely.
  ["GET", { Origin: "https://evil.com" }, true],
  ["HEAD", {}, true],
  ["OPTIONS", {}, true],
  // Same-origin passes via Origin or Referer.
  ["POST", { Origin: "http://localhost" }, true],
  ["POST", { Referer: "http://localhost/projects" }, true],
  ["PATCH", { Origin: "http://localhost" }, true],
  ["DELETE", { Origin: "http://localhost" }, true],
  // Cross-origin or missing credentials fail closed.
  ["POST", { Origin: "https://evil.com" }, false],
  ["POST", { Referer: "https://evil.com/phishing" }, false],
  ["PATCH", { Origin: "https://attacker.example" }, false],
  ["POST", {}, false],
  // Subdomain lookalikes are not the origin.
  ["POST", { Referer: "http://localhost.evil.com/" }, false],
];

describe("checkCsrfOrigin", () => {
  it.each(cases)("%s %j is %s", async (method, headers, allowed) => {
    const result = checkCsrfOrigin(makeEvent(method, TEST_URL, headers));
    if (allowed) {
      expect(result).toBeNull();
    } else {
      expect(result?.status).toBe(403);
      expect((await result!.json()).error).toBe("csrf_error");
    }
  });
});
