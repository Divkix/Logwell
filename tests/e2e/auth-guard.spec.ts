import { expect, test } from "@playwright/test";

test.describe("Auth Guard", () => {
  test("redirects unauthenticated visitors to /login", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login/);
  });
});
