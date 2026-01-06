import { expect, type Page, test } from '@playwright/test';
import { ingestOtlpLogs } from './helpers/otlp';

/**
 * E2E tests for Live Stream SSE Integration
 *
 * Phase 9.3 from the implementation plan
 * Tests the wiring between LiveToggle component and SSE stream
 */

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

async function ingestLog(
  page: Page,
  apiKey: string,
  log: { level: 'debug' | 'info' | 'warn' | 'error' | 'fatal'; message: string },
) {
  await ingestOtlpLogs(page, apiKey, [{ level: log.level, message: log.message }]);
}

test.describe('Live Stream SSE Integration', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `live-stream-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('enabling live starts receiving logs', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Wait for page to fully load and log table to be visible
    await expect(page.locator('[data-testid="log-table"]')).toBeVisible();

    // Wait for SSE connection to establish (the pulse turns green)
    const livePulse = page.locator('[data-testid="live-pulse"]');
    await expect(livePulse).toHaveClass(/bg-green-500/, { timeout: 5000 });

    // Give SSE connection time to fully establish on server side
    // This is necessary because the green pulse shows toggle state, not connection state
    await page.waitForTimeout(2000);

    // Ingest a log while on the page
    await ingestLog(page, testProject.apiKey, {
      level: 'info',
      message: 'Live stream test log - should appear',
    });

    // The log should appear via SSE within reasonable time
    // Use filter({ visible: true }) since we have dual mobile/desktop layouts (sm:hidden vs hidden sm:table)
    // Using longer timeout to account for SSE batching (1.5s window) plus network latency
    await expect(
      page.getByText('Live stream test log - should appear').filter({ visible: true }),
    ).toBeVisible({
      timeout: 10000,
    });
  });

  test('disabling live stops stream', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Wait for page to be ready
    await expect(page.locator('[data-testid="log-table"]')).toBeVisible();

    // Disable live toggle
    const liveSwitch = page.getByRole('switch', { name: /toggle live streaming/i });
    await liveSwitch.click();

    // Verify toggle is now off (gray pulse)
    const livePulse = page.locator('[data-testid="live-pulse"]');
    await expect(livePulse).not.toHaveClass(/bg-green-500/);

    // Ingest a log while live is disabled
    await ingestLog(page, testProject.apiKey, {
      level: 'error',
      message: 'Log after disabling live - should NOT appear',
    });

    // Wait to ensure the log would have time to appear if streaming was active
    await page.waitForTimeout(3000);

    // The log should NOT appear since live is disabled
    // Check that no element with this text exists (avoids dual layout visibility issues)
    await expect(page.getByText('Log after disabling live - should NOT appear')).toHaveCount(0);
  });

  test('search pauses live with notice', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Verify live is initially enabled
    const livePulse = page.locator('[data-testid="live-pulse"]');
    await expect(livePulse).toHaveClass(/bg-green-500/);

    // Type in search input (use type() to ensure input events fire)
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.click();
    await searchInput.type('test', { delay: 50 });

    // Wait for debounce (300ms) and navigation to complete
    await page.waitForTimeout(500);
    await page.waitForURL(/search=test/, { timeout: 5000 });

    // Live should be paused (toggle disabled or showing paused state)
    const liveSwitch = page.getByRole('switch', { name: /toggle live streaming/i });
    await expect(liveSwitch).toBeDisabled();

    // A notice should be visible explaining why live is paused
    const pauseNotice = page.getByTestId('live-paused-notice');
    await expect(pauseNotice).toBeVisible();
    await expect(pauseNotice).toContainText(/paused|search/i);

    // Clear search
    await searchInput.clear();

    // Wait for debounce and navigation to complete (URL should no longer have search param)
    await page.waitForTimeout(500);
    await page.waitForURL(/projects\/[^/]+$/, { timeout: 5000 });

    // Live should resume (toggle enabled again)
    await expect(liveSwitch).toBeEnabled();
    await expect(pauseNotice).not.toBeVisible();
  });
});
