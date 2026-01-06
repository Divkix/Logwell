import { expect, type Page, test } from '@playwright/test';
import { ingestOtlpLogs } from './helpers/otlp';

// Test user credentials (matches seeded admin from scripts/seed-admin.ts)
const TEST_USER = {
  username: 'admin',
  password: 'adminpass',
};

/**
 * Helper to perform login
 */
async function login(page: Page) {
  await page.goto('/login');
  await page.waitForSelector('form');

  const usernameInput = page.getByLabel(/username/i);
  const passwordInput = page.getByLabel(/password/i);

  await usernameInput.click();
  await usernameInput.fill(TEST_USER.username);
  await expect(usernameInput).toHaveValue(TEST_USER.username);

  await passwordInput.click();
  await passwordInput.fill(TEST_USER.password);
  await expect(passwordInput).toHaveValue(TEST_USER.password);

  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL('/', { timeout: 15000 });
}

/**
 * Helper to create a project via API
 */
async function createProject(page: Page, name: string) {
  const response = await page.request.post('/api/projects', {
    data: { name },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

/**
 * Helper to delete a project via API
 */
async function deleteProject(page: Page, projectId: string) {
  const response = await page.request.delete(`/api/projects/${projectId}`);
  return response.ok();
}

/**
 * Helper to send OTLP logs
 */
async function sendOTLPLogs(
  page: Page,
  apiKey: string,
  count: number,
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal' = 'info',
) {
  const logs = [];
  for (let i = 0; i < count; i++) {
    logs.push({
      level,
      message: `${level.toUpperCase()} log message ${i}`,
    });
  }

  await ingestOtlpLogs(page, apiKey, logs);
}

test.describe('Cursor-based Pagination', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `pagination-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('shows load more button when more logs exist', async ({ page }) => {
    // Create 150 logs (more than default limit of 100)
    await sendOTLPLogs(page, testProject.apiKey, 150, 'info');

    // Navigate to project page
    await page.goto(`/projects/${testProject.id}`);

    // Wait for initial logs to load
    await page.waitForSelector('[data-testid="log-table"]', { timeout: 10000 });

    // Should show "more available" text
    await expect(page.locator('text=more available')).toBeVisible();

    // Load more button should be visible
    const loadMoreButton = page.locator('[data-testid="load-more-button"]');
    await expect(loadMoreButton).toBeVisible();
    await expect(loadMoreButton).toHaveText('Load More');
  });

  test('hides load more button when all logs are loaded', async ({ page }) => {
    // Create only 50 logs (less than default limit)
    await sendOTLPLogs(page, testProject.apiKey, 50, 'info');

    await page.goto(`/projects/${testProject.id}`);
    await page.waitForSelector('[data-testid="log-table"]', { timeout: 10000 });

    // Load more button should NOT be visible
    const loadMoreButton = page.locator('[data-testid="load-more-button"]');
    await expect(loadMoreButton).not.toBeVisible();

    // Should NOT show "more available" text
    await expect(page.locator('text=more available')).not.toBeVisible();
  });

  test('loads more logs when clicking load more button', async ({ page }) => {
    // Create 150 logs
    await sendOTLPLogs(page, testProject.apiKey, 150, 'info');

    await page.goto(`/projects/${testProject.id}`);
    await page.waitForSelector('[data-testid="log-table"]', { timeout: 10000 });

    // Get initial log count (log-row is the test ID for table rows)
    const initialRows = await page.locator('[data-testid="log-row"]').count();
    expect(initialRows).toBeLessThanOrEqual(100);

    // Click load more button
    const loadMoreButton = page.locator('[data-testid="load-more-button"]');
    await expect(loadMoreButton).toBeVisible();

    // Click and wait for loading state
    await loadMoreButton.click();

    // Should show loading state
    await expect(loadMoreButton).toContainText('Loading...');

    // Wait for more logs to load
    await page.waitForTimeout(2000);

    // Should have more logs now
    const newRowCount = await page.locator('[data-testid="log-row"]').count();
    expect(newRowCount).toBeGreaterThan(initialRows);

    // Button should return to normal state or disappear if all logs loaded
    const buttonVisible = await loadMoreButton.isVisible();
    if (buttonVisible) {
      await expect(loadMoreButton).toContainText('Load More');
    }
  });
});
