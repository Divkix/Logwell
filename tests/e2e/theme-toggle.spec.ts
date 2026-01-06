import { expect, type Page, test } from '@playwright/test';

const TEST_USER = {
  username: 'admin',
  password: 'adminpass',
};

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('form');

  const usernameInput = page.getByLabel(/username/i);
  const passwordInput = page.getByLabel(/password/i);

  // Wait for Svelte hydration
  await page.waitForTimeout(500);

  // Clear and fill username - use clear() first to ensure clean state
  await usernameInput.clear();
  await usernameInput.fill(TEST_USER.username);
  await expect(usernameInput).toHaveValue(TEST_USER.username);

  // Clear and fill password
  await passwordInput.clear();
  await passwordInput.fill(TEST_USER.password);
  await expect(passwordInput).toHaveValue(TEST_USER.password);

  // Click sign in and wait for redirect
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL('/', { timeout: 15000 });
}

test.describe('Theme Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // Clear theme storage after login to ensure consistent initial state
    await page.evaluate(() => localStorage.removeItem('mode-watcher-mode'));
    // Reload to apply the cleared state
    await page.reload();
  });

  test('should toggle between light and dark mode', async ({ page }) => {
    const html = page.locator('html');
    const toggleButton = page.getByRole('button', { name: /toggle theme/i });

    // Initial state: light mode (sun icon visible)
    await expect(page.locator('[data-testid="sun-icon"]')).toBeVisible();
    await expect(page.locator('[data-testid="moon-icon"]')).not.toBeVisible();
    await expect(html).not.toHaveClass(/dark/);

    // Click to switch to dark mode
    await toggleButton.click();

    // Dark mode: moon icon, .dark class present
    await expect(page.locator('[data-testid="moon-icon"]')).toBeVisible();
    await expect(page.locator('[data-testid="sun-icon"]')).not.toBeVisible();
    await expect(html).toHaveClass(/dark/);

    // Click to switch back to light mode
    await toggleButton.click();

    // Light mode again
    await expect(page.locator('[data-testid="sun-icon"]')).toBeVisible();
    await expect(html).not.toHaveClass(/dark/);
  });

  test('should persist theme preference across page reload', async ({ page }) => {
    const html = page.locator('html');
    const toggleButton = page.getByRole('button', { name: /toggle theme/i });

    // Switch to dark mode
    await toggleButton.click();
    await expect(html).toHaveClass(/dark/);

    // Verify localStorage
    const storedMode = await page.evaluate(() => localStorage.getItem('mode-watcher-mode'));
    expect(storedMode).toBe('dark');

    // Reload page
    await page.reload();

    // Theme should persist
    await expect(html).toHaveClass(/dark/);
    await expect(page.locator('[data-testid="moon-icon"]')).toBeVisible();
  });

  test('should update color-scheme style attribute', async ({ page }) => {
    const html = page.locator('html');
    const toggleButton = page.getByRole('button', { name: /toggle theme/i });

    // Switch to dark mode
    await toggleButton.click();

    // Wait for dark class to be applied
    await expect(html).toHaveClass(/dark/);

    // Check color-scheme style attribute contains dark
    await expect(html).toHaveAttribute('style', /color-scheme:.*dark/);
  });
});
