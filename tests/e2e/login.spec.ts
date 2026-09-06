import { expect, test } from "@playwright/test";

const TEST_USER = {
  username: "admin",
  password: "adminpass", // From .env ADMIN_PASSWORD
};

test.describe("Login Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.waitForSelector("form");
  });

  test("redirects to / after successful login", async ({ page }) => {
    await expect(async () => {
      await page.getByLabel(/username/i).fill(TEST_USER.username);
      await page.getByLabel(/password/i).fill(TEST_USER.password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page).toHaveURL("/", { timeout: 10000 });
    }).toPass({ timeout: 45000 });
  });

  test("shows an error for invalid credentials", async ({ page }) => {
    await expect(async () => {
      await page.getByLabel(/username/i).fill(TEST_USER.username);
      await page.getByLabel(/password/i).fill("WrongPassword123!");
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page.getByText(/invalid|incorrect|wrong|credentials/i)).toBeVisible({
        timeout: 10000,
      });
    }).toPass({ timeout: 45000 });

    await expect(page).toHaveURL(/\/login/);
  });
});
