import { expect, type Page, test } from "@playwright/test";

const TEST_USER = {
  username: "admin",
  password: "adminpass",
};

async function login(page: Page) {
  await page.goto("/login");
  await page.waitForSelector("form");

  await expect(async () => {
    await page.getByLabel(/username/i).fill(TEST_USER.username);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/", { timeout: 10000 });
  }).toPass({ timeout: 45000 });
}

test.describe("Theme Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.evaluate(() => localStorage.removeItem("mode-watcher-mode"));
    await page.reload();
  });

  test("toggles between light and dark mode", async ({ page }) => {
    const html = page.locator("html");
    const toggleButton = page.getByRole("button", { name: /toggle theme/i });

    await expect(page.locator('[data-testid="sun-icon"]')).toBeVisible();
    await expect(html).not.toHaveClass(/dark/);

    await toggleButton.click();

    await expect(page.locator('[data-testid="moon-icon"]')).toBeVisible();
    await expect(html).toHaveClass(/dark/);
  });
});
