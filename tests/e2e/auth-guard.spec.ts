import { expect, test } from "@playwright/test";

const TEST_USER = {
  username: "admin",
  password: "adminpass",
};

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.waitForSelector("form");

  await expect(async () => {
    await page.getByLabel(/username/i).fill(TEST_USER.username);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/", { timeout: 10000 });
  }).toPass({ timeout: 45000 });
}

test.describe("Auth Guard - Unauthenticated Access", () => {
  test("should redirect to /login when accessing root path unauthenticated", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login/);
  });

  test("should redirect to /login when accessing /projects/[id] unauthenticated", async ({
    page,
  }) => {
    await page.goto("/projects/some-project-id");

    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("App Layout - Header", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("should render header with application title", async ({ page }) => {
    const header = page.locator("header");
    await expect(header).toBeVisible();
    await expect(header.getByText(/logwell/i)).toBeVisible();
  });

  test("should render header with logout button", async ({ page }) => {
    const header = page.locator("header");
    await expect(header).toBeVisible();

    const logoutButton = header.getByRole("button", { name: /logout|sign out/i });
    await expect(logoutButton).toBeVisible();
  });

  test("should render header with theme toggle", async ({ page }) => {
    const header = page.locator("header");
    await expect(header).toBeVisible();

    const themeToggle = header.getByRole("button", { name: /toggle theme|theme/i });
    await expect(themeToggle).toBeVisible();
  });

  test("should display user info in header", async ({ page }) => {
    const header = page.locator("header");
    await expect(header).toBeVisible();

    await expect(header.getByText(/admin/i)).toBeVisible();
  });
});

test.describe("Logout Functionality", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("should logout and redirect to /login when clicking logout button", async ({ page }) => {
    const header = page.locator("header");
    const logoutButton = header.getByRole("button", { name: /logout|sign out/i });
    await logoutButton.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test("should not be able to access protected routes after logout", async ({ page }) => {
    const header = page.locator("header");
    const logoutButton = header.getByRole("button", { name: /logout|sign out/i });
    await logoutButton.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    await page.goto("/");

    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("App Layout - Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("should have navigation link to dashboard/home", async ({ page }) => {
    const header = page.locator("header");

    const homeLink = header.getByRole("link", { name: /home|dashboard|logwell/i });
    await expect(homeLink).toBeVisible();
  });
});
