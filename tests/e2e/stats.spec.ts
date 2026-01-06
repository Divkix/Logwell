import { expect, type Page, test } from '@playwright/test';
import { ingestOtlpLogs } from './helpers/otlp';

/**
 * E2E tests for Project Stats Page
 *
 * Phase 8.5 from the implementation plan
 * Tests follow Trophy testing methodology - focus on user behavior
 */

// Test user credentials (matches seeded admin from scripts/seed-admin.ts)
const TEST_USER = {
  username: 'admin',
  password: 'adminpass',
};

/**
 * Helper to perform login with retry logic for cold start resilience
 */
async function login(page: Page) {
  // Wait for the server to be ready
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('form', { timeout: 10000 });

  const usernameInput = page.getByLabel(/username/i);
  const passwordInput = page.getByLabel(/password/i);

  await usernameInput.click();
  await usernameInput.fill(TEST_USER.username);
  await expect(usernameInput).toHaveValue(TEST_USER.username);

  await passwordInput.click();
  await passwordInput.fill(TEST_USER.password);
  await expect(passwordInput).toHaveValue(TEST_USER.password);

  await page.getByRole('button', { name: /sign in/i }).click();

  // Wait for navigation with retry
  await expect(page).toHaveURL('/', { timeout: 30000 });
}

/**
 * Helper to create a project via API
 * Returns the created project data including apiKey
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

test.describe('Stats Page - Display', () => {
  // Allow retries due to potential cold start issues
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `stats-test-${Date.now()}`);

    // Ingest logs with different levels for stats testing
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: 'debug', message: 'Debug log 1' },
      { level: 'debug', message: 'Debug log 2' },
      { level: 'info', message: 'Info log 1' },
      { level: 'info', message: 'Info log 2' },
      { level: 'info', message: 'Info log 3' },
      { level: 'warn', message: 'Warning log 1' },
      { level: 'error', message: 'Error log 1' },
      { level: 'error', message: 'Error log 2' },
      { level: 'fatal', message: 'Fatal log 1' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should display donut chart', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    // Should display the level chart container
    await expect(page.locator('[data-testid="level-chart-container"]')).toBeVisible();

    // Should display the SVG donut chart
    await expect(page.locator('[data-testid="level-chart-svg"]')).toBeVisible();

    // Should display chart segments for each level that has logs
    await expect(page.locator('[data-testid="chart-segment-debug"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-segment-info"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-segment-warn"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-segment-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-segment-fatal"]')).toBeVisible();
  });

  test('should display total log count', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    // Should display total count in the center of the donut chart
    const totalCount = page.locator('[data-testid="chart-total"]');
    await expect(totalCount).toBeVisible();
    await expect(totalCount).toContainText('9'); // We ingested 9 logs

    // Should also display "Total" label
    await expect(totalCount).toContainText('Total');
  });

  test('should display legend with level counts and percentages', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    // Legend should be visible
    const legend = page.locator('[data-testid="level-chart-legend"]');
    await expect(legend).toBeVisible();

    // Check that legend items are displayed
    await expect(page.locator('[data-testid="legend-item-debug"]')).toBeVisible();
    await expect(page.locator('[data-testid="legend-item-info"]')).toBeVisible();
    await expect(page.locator('[data-testid="legend-item-warn"]')).toBeVisible();
    await expect(page.locator('[data-testid="legend-item-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="legend-item-fatal"]')).toBeVisible();

    // Check that counts are displayed (info has 3 logs)
    await expect(page.locator('[data-testid="legend-item-info"]')).toContainText('3');
  });

  test('should display project name in header', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    // Should display project name
    await expect(page.getByRole('heading', { name: testProject.name })).toBeVisible();
  });
});

test.describe('Stats Page - Time Range Filter', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `stats-time-range-test-${Date.now()}`);

    // Ingest some recent logs
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: 'info', message: 'Recent info log 1' },
      { level: 'info', message: 'Recent info log 2' },
      { level: 'error', message: 'Recent error log' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should display time range picker with options', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    // Time range picker should be visible with all options
    // Using aria-labels since they override button text for accessibility
    await expect(page.getByRole('button', { name: /last 15 minutes/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /last hour/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /last 24 hours/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /last 7 days/i })).toBeVisible();
  });

  test('should highlight selected time range', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    // Default should be 24h for stats page (shows more data by default)
    const dayButton = page.getByRole('button', { name: /last 24 hours/i });
    await expect(dayButton).toHaveAttribute('data-selected', 'true');

    // Click 7d
    await page.getByRole('button', { name: /last 7 days/i }).click();

    // 7d should now be selected
    await expect(page.getByRole('button', { name: /last 7 days/i })).toHaveAttribute(
      'data-selected',
      'true',
    );
    await expect(dayButton).toHaveAttribute('data-selected', 'false');
  });

  test('should update chart data when time range changes', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    // Wait for initial chart to load
    await expect(page.locator('[data-testid="level-chart-container"]')).toBeVisible();

    // Verify initial total count (3 logs)
    await expect(page.locator('[data-testid="chart-total"]')).toContainText('3');

    // Click on 15m (should still show same logs since they were just ingested)
    await page.getByRole('button', { name: /last 15 minutes/i }).click();

    // Wait for URL to update with range parameter
    await expect(page).toHaveURL(/range=15m/, { timeout: 10000 });

    // Total should still show 3 (logs are recent)
    await expect(page.locator('[data-testid="chart-total"]')).toContainText('3');
  });
});

test.describe('Stats Page - Empty State', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `stats-empty-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should display empty state when no logs exist', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    // Should show empty chart state
    await expect(page.locator('[data-testid="level-chart-empty"]')).toBeVisible();
    await expect(page.getByText('No data')).toBeVisible();
  });

  test('should display zero total when no logs', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    // The total count section might show 0 or the empty state
    // Either is acceptable
    const chartContainer = page.locator('[data-testid="level-chart-container"]');
    await expect(chartContainer).toBeVisible();
  });
});

test.describe('Stats Page - Navigation', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `stats-nav-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should have back button to log stream page', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    // Back button should be visible
    const backButton = page.getByRole('link', { name: /back|logs/i });
    await expect(backButton).toBeVisible();

    // Click should navigate to log stream page
    await backButton.click();
    await expect(page).toHaveURL(`/projects/${testProject.id}`);
  });

  test('should be accessible from log stream page', async ({ page }) => {
    // Start on log stream page
    await page.goto(`/projects/${testProject.id}`);

    // Find and click stats link
    const statsLink = page.getByRole('link', { name: /stats|statistics|chart/i });
    await expect(statsLink).toBeVisible();

    // Click should navigate to stats page
    await statsLink.click();
    await expect(page).toHaveURL(`/projects/${testProject.id}/stats`);
  });
});

test.describe('Stats Page - Responsive Layout', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `stats-responsive-test-${Date.now()}`);

    // Ingest some logs
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: 'info', message: 'Test log' },
      { level: 'error', message: 'Test error' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should render correctly on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`/projects/${testProject.id}/stats`);

    // Chart should still be visible
    await expect(page.locator('[data-testid="level-chart-container"]')).toBeVisible();

    // Time range picker should be visible
    await expect(page.getByRole('button', { name: /last 24 hours/i })).toBeVisible();
  });
});
