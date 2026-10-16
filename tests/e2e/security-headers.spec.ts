import { expect, type Page, test } from "@playwright/test";

const TEST_USER = {
  username: "admin",
  password: "adminpass",
};

// Collects every CSP violation the page reports: the browser's own console message, plus a
// `securitypolicyviolation` listener installed before any page script runs.
async function trackCspViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];

  page.on("console", (message) => {
    if (/content.security.policy|csp violation/i.test(message.text())) {
      violations.push(message.text());
    }
  });

  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });

  return violations;
}

test.describe("Security headers", () => {
  test("serves a nonce-based CSP that forbids framing", async ({ page }) => {
    const response = await page.goto("/login");
    const headers = response!.headers();

    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("same-origin");
  });

  test("the app runs under the CSP without violations", async ({ page }) => {
    const violations = await trackCspViolations(page);
    await page.addInitScript(() => localStorage.setItem("mode-watcher-mode", "dark"));

    await page.goto("/login");
    await page.waitForSelector("form");

    // Set by app.html's nonce-carrying theme script, before hydration.
    await expect(page.locator("html")).toHaveClass(/dark/);

    await expect(async () => {
      await page.getByLabel(/username/i).fill(TEST_USER.username);
      await page.getByLabel(/password/i).fill(TEST_USER.password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page).toHaveURL("/", { timeout: 10000 });
    }).toPass({ timeout: 45000 });

    await page.waitForLoadState("networkidle");

    expect(violations).toEqual([]);
  });
});
