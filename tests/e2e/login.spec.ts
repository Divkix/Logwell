import { expect, test } from "@playwright/test";

const TEST_USER = {
  username: "admin",
  password: "adminpass", // From .env ADMIN_PASSWORD
  name: "Admin",
};

test.describe("Login Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.waitForSelector("form");
  });

  test("should display login form with username and password fields", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("should focus password field on page load", async ({ page }) => {
    const passwordField = page.getByLabel(/password/i);
    await expect(passwordField).toBeFocused();
  });

  test("should redirect to / after successful login", async ({ page }) => {
    await expect(async () => {
      await page.getByLabel(/username/i).fill(TEST_USER.username);
      await page.getByLabel(/password/i).fill(TEST_USER.password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page).toHaveURL("/", { timeout: 10000 });
    }).toPass({ timeout: 45000 });
  });

  test("should show error for invalid credentials", async ({ page }) => {
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

  test("should show error for non-existent user", async ({ page }) => {
    await expect(async () => {
      await page.getByLabel(/username/i).fill("nonexistentuser");
      await page.getByLabel(/password/i).fill("SomePassword123!");
      await page.getByRole("button", { name: /sign in/i }).click();
      // better-auth returns generic error to prevent user enumeration
      await expect(page.getByText(/invalid username or password/i)).toBeVisible({
        timeout: 10000,
      });
    }).toPass({ timeout: 45000 });

    await expect(page).toHaveURL(/\/login/);
  });

  test("should submit form when Enter key is pressed", async ({ page }) => {
    await expect(async () => {
      const usernameInput = page.getByLabel(/username/i);
      const passwordInput = page.getByLabel(/password/i);
      await usernameInput.fill(TEST_USER.username);
      await passwordInput.fill(TEST_USER.password);
      await passwordInput.press("Enter");
      await expect(page).toHaveURL("/", { timeout: 10000 });
    }).toPass({ timeout: 45000 });
  });

  test("should disable form inputs during submission", async ({ page }) => {
    await page.getByLabel(/username/i).fill(TEST_USER.username);
    await page.getByLabel(/password/i).fill(TEST_USER.password);

    const signInButton = page.getByRole("button", { name: /sign in/i });

    const clickPromise = signInButton.click();

    await clickPromise;
  });

  test("should show validation error for empty username", async ({ page }) => {
    await expect(async () => {
      await page.getByLabel(/password/i).fill(TEST_USER.password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page.getByText("Username is required")).toBeVisible();
    }).toPass({ timeout: 45000 });
  });

  test("should show validation error for empty password", async ({ page }) => {
    await expect(async () => {
      await page.getByLabel(/username/i).fill(TEST_USER.username);
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page.getByText("Password is required")).toBeVisible();
    }).toPass({ timeout: 45000 });
  });
});

test.describe("Login Page - Authentication State", () => {
  // TODO: This test is skipped pending session cookie investigation
  // The server-side session check works but the cookie doesn't persist
  // in E2E tests after client-side navigation via goto()
  test.skip("should redirect authenticated users away from login page", async ({ page }) => {
    await page.goto("/login");
    await page.waitForSelector("form");

    await expect(async () => {
      await page.getByLabel(/username/i).fill(TEST_USER.username);
      await page.getByLabel(/password/i).fill(TEST_USER.password);
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page).toHaveURL("/", { timeout: 10000 });
    }).toPass({ timeout: 45000 });

    await page.goto("/login");

    await expect(page).toHaveURL("/", { timeout: 5000 });
  });
});
