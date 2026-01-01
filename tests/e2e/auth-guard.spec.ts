import { expect, test } from '@playwright/test';

/**
 * E2E tests for App Layout with Auth Guard
 *
 * Phase 8.2 from the implementation plan
 * Tests follow Trophy testing methodology - focus on user behavior
 */

// Test user credentials (matches seeded admin from scripts/seed-admin.ts)
const TEST_USER = {
  email: 'admin@example.com',
  password: 'adminpass',
};

/**
 * Helper to perform login
 */
async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.waitForSelector('form');

  const emailInput = page.getByLabel(/email/i);
  const passwordInput = page.getByLabel(/password/i);

  // Clear and fill email, verify value
  await emailInput.click();
  await emailInput.fill(TEST_USER.email);
  await expect(emailInput).toHaveValue(TEST_USER.email);

  // Clear and fill password, verify value
  await passwordInput.click();
  await passwordInput.fill(TEST_USER.password);
  await expect(passwordInput).toHaveValue(TEST_USER.password);

  // Click sign in and wait for redirect
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL('/', { timeout: 15000 });
}

test.describe('Auth Guard - Unauthenticated Access', () => {
  test('should redirect to /login when accessing root path unauthenticated', async ({ page }) => {
    // Navigate directly to protected root path without authentication
    await page.goto('/');

    // Should be redirected to login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect to /login when accessing /projects/[id] unauthenticated', async ({
    page,
  }) => {
    // Navigate to a protected project route without authentication
    await page.goto('/projects/some-project-id');

    // Should be redirected to login page
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('App Layout - Header', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test in this block
    await login(page);
  });

  test('should render header with application title', async ({ page }) => {
    // Header should have the app title/logo
    const header = page.locator('header');
    await expect(header).toBeVisible();
    await expect(header.getByText(/sv-logger/i)).toBeVisible();
  });

  test('should render header with logout button', async ({ page }) => {
    // Header should have logout button
    const header = page.locator('header');
    await expect(header).toBeVisible();

    const logoutButton = header.getByRole('button', { name: /logout|sign out/i });
    await expect(logoutButton).toBeVisible();
  });

  test('should render header with theme toggle', async ({ page }) => {
    // Header should have theme toggle
    const header = page.locator('header');
    await expect(header).toBeVisible();

    // Theme toggle button (sun/moon icon)
    const themeToggle = header.getByRole('button', { name: /toggle theme|theme/i });
    await expect(themeToggle).toBeVisible();
  });

  test('should display user info in header', async ({ page }) => {
    // Header should show logged in user info
    const header = page.locator('header');
    await expect(header).toBeVisible();

    // Should show user email or name
    await expect(header.getByText(/admin/i)).toBeVisible();
  });
});

test.describe('Logout Functionality', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test in this block
    await login(page);
  });

  test('should logout and redirect to /login when clicking logout button', async ({ page }) => {
    // Find and click logout button
    const header = page.locator('header');
    const logoutButton = header.getByRole('button', { name: /logout|sign out/i });
    await logoutButton.click();

    // Should be redirected to login page
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('should not be able to access protected routes after logout', async ({ page }) => {
    // First logout
    const header = page.locator('header');
    const logoutButton = header.getByRole('button', { name: /logout|sign out/i });
    await logoutButton.click();

    // Wait for redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });

    // Try to access protected route directly
    await page.goto('/');

    // Should still be on login page (redirected)
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('App Layout - Navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test in this block
    await login(page);
  });

  test('should have navigation link to dashboard/home', async ({ page }) => {
    // Header should have a way to navigate home
    const header = page.locator('header');

    // Either the logo/title is clickable or there's a home link
    const homeLink = header.getByRole('link', { name: /home|dashboard|sv-logger/i });
    await expect(homeLink).toBeVisible();
  });
});
