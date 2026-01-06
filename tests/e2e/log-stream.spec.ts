import { expect, type Page, test } from '@playwright/test';
import { getLevelBadge, getLogMessage } from './helpers/log-selectors';
import { ingestOtlpLogs } from './helpers/otlp';

/**
 * E2E tests for Project Log Stream Page
 *
 * Phase 8.4 from the implementation plan
 * Tests follow Trophy testing methodology - focus on user behavior
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

/**
 * Helper to ingest a log via API
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

async function ingestLog(
  page: Page,
  apiKey: string,
  log: {
    level: LogLevel;
    message: string;
    metadata?: Record<string, unknown>;
    source_file?: string;
    line_number?: number;
    request_id?: string;
    user_id?: string;
    ip_address?: string;
  },
) {
  const attributes: Record<string, unknown> = { ...(log.metadata ?? {}) };

  // Map fields to OTLP semantic conventions
  if (log.source_file) attributes['code.filepath'] = log.source_file;
  if (log.line_number !== undefined) attributes['code.lineno'] = log.line_number;
  if (log.request_id) attributes['request.id'] = log.request_id;
  if (log.user_id) attributes['enduser.id'] = log.user_id;
  if (log.ip_address) attributes['client.address'] = log.ip_address;

  await ingestOtlpLogs(page, apiKey, [{ level: log.level, message: log.message, attributes }]);
}

test.describe('Log Stream Page - Display', () => {
  // Allow retries due to potential cold start issues
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `log-stream-test-${Date.now()}`);

    // Ingest some test logs
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: 'info', message: 'Application started successfully' },
      { level: 'warn', message: 'Deprecated API usage detected' },
      { level: 'error', message: 'Failed to connect to database' },
      { level: 'debug', message: 'Processing request payload' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should display log table with entries', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Should display log table
    await expect(page.locator('[data-testid="log-table"]')).toBeVisible();

    // Should display log entries (scoped to table layout for desktop viewport)
    await expect(getLogMessage(page, 'Application started successfully')).toBeVisible();
    await expect(getLogMessage(page, 'Deprecated API usage detected')).toBeVisible();
    await expect(getLogMessage(page, 'Failed to connect to database')).toBeVisible();
    await expect(getLogMessage(page, 'Processing request payload')).toBeVisible();
  });

  test('should display project name in header', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Should display project name
    await expect(page.getByRole('heading', { name: testProject.name })).toBeVisible();
  });

  test('should display level badges for each log', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Should display level badges (scoped to table layout for desktop viewport)
    await expect(getLevelBadge(page, 'INFO')).toBeVisible();
    await expect(getLevelBadge(page, 'WARN')).toBeVisible();
    await expect(getLevelBadge(page, 'ERROR')).toBeVisible();
    await expect(getLevelBadge(page, 'DEBUG')).toBeVisible();
  });
});

test.describe('Log Stream Page - Live Toggle', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `live-toggle-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should show live toggle in enabled state by default', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Live toggle should be visible
    const liveToggle = page.locator('[data-testid="live-pulse"]');
    await expect(liveToggle).toBeVisible();

    // Should show green pulse when enabled
    await expect(liveToggle).toHaveClass(/bg-green-500/);
  });

  test('should receive new logs when live streaming is enabled', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Wait for page to load
    await expect(page.locator('[data-testid="log-table"]')).toBeVisible();

    // Ingest a new log while on the page
    await ingestLog(page, testProject.apiKey, {
      level: 'info',
      message: 'New log from live stream test',
    });

    // The new log should appear in the table (via SSE) - scoped to table layout
    await expect(getLogMessage(page, 'New log from live stream test')).toBeVisible({
      timeout: 5000,
    });
  });

  test('should stop receiving logs when live toggle is disabled', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Disable live toggle
    const liveSwitch = page.getByRole('switch', { name: /toggle live streaming/i });
    await liveSwitch.click();

    // Pulse should no longer be green
    const livePulse = page.locator('[data-testid="live-pulse"]');
    await expect(livePulse).not.toHaveClass(/bg-green-500/);

    // Ingest a new log
    await ingestLog(page, testProject.apiKey, {
      level: 'error',
      message: 'Log after live disabled',
    });

    // Wait a bit to ensure the log doesn't appear
    await page.waitForTimeout(2000);

    // The new log should NOT appear (live is disabled) - scoped to table layout
    await expect(getLogMessage(page, 'Log after live disabled')).not.toBeVisible();
  });
});

test.describe('Log Stream Page - Search Filter', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `search-test-${Date.now()}`);

    // Ingest logs with distinct messages for search testing
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: 'info', message: 'User authentication successful' },
      { level: 'info', message: 'Payment processing completed' },
      { level: 'error', message: 'Database connection failed' },
      { level: 'warn', message: 'Memory usage high' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should filter logs by search term', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Wait for logs to load (scoped to table layout)
    await expect(getLogMessage(page, 'User authentication successful')).toBeVisible();

    // Type in search input
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('database');

    // Wait for debounce and API call
    await page.waitForTimeout(500);

    // Should show matching log (scoped to table layout)
    await expect(getLogMessage(page, 'Database connection failed')).toBeVisible();

    // Should hide non-matching logs (scoped to table layout)
    await expect(getLogMessage(page, 'User authentication successful')).not.toBeVisible();
    await expect(getLogMessage(page, 'Payment processing completed')).not.toBeVisible();
  });

  test('should show all logs when search is cleared', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Apply search filter
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('payment');
    await page.waitForTimeout(500);

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(500);

    // All logs should be visible again (scoped to table layout)
    await expect(getLogMessage(page, 'User authentication successful')).toBeVisible();
    await expect(getLogMessage(page, 'Payment processing completed')).toBeVisible();
    await expect(getLogMessage(page, 'Database connection failed')).toBeVisible();
  });
});

test.describe('Log Stream Page - Level Filter', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `level-filter-test-${Date.now()}`);

    // Ingest logs with different levels
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: 'debug', message: 'Debug message one' },
      { level: 'info', message: 'Info message one' },
      { level: 'warn', message: 'Warning message one' },
      { level: 'error', message: 'Error message one' },
      { level: 'fatal', message: 'Fatal message one' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should filter logs by level', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Wait for logs to load (scoped to table layout)
    await expect(getLogMessage(page, 'Error message one')).toBeVisible();

    // Click on error level button to select only error
    const levelFilter = page.locator('[data-testid="level-filter"]');
    await levelFilter.getByRole('button', { name: /error/i }).click();

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Should show only error logs (scoped to table layout)
    await expect(getLogMessage(page, 'Error message one')).toBeVisible();

    // Should hide other level logs (scoped to table layout)
    await expect(getLogMessage(page, 'Debug message one')).not.toBeVisible();
    await expect(getLogMessage(page, 'Info message one')).not.toBeVisible();
    await expect(getLogMessage(page, 'Warning message one')).not.toBeVisible();
  });

  test('should support multiple level selection', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Wait for logs to load (scoped to table layout)
    await expect(getLogMessage(page, 'Error message one')).toBeVisible();

    const levelFilter = page.locator('[data-testid="level-filter"]');

    // Select error level
    await levelFilter.getByRole('button', { name: /error/i }).click();
    await page.waitForTimeout(300);

    // Select fatal level
    await levelFilter.getByRole('button', { name: /fatal/i }).click();
    await page.waitForTimeout(500);

    // Should show error and fatal logs (scoped to table layout)
    await expect(getLogMessage(page, 'Error message one')).toBeVisible();
    await expect(getLogMessage(page, 'Fatal message one')).toBeVisible();

    // Should hide other levels (scoped to table layout)
    await expect(getLogMessage(page, 'Debug message one')).not.toBeVisible();
    await expect(getLogMessage(page, 'Info message one')).not.toBeVisible();
  });
});

test.describe('Log Stream Page - Time Range Filter', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `time-range-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should display time range picker with options', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Time range picker should be visible with all options
    await expect(page.getByRole('button', { name: /last 15 minutes/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /last hour/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /last 24 hours/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /last 7 days/i })).toBeVisible();
  });

  test('should highlight selected time range', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Default should be 1h
    const hourButton = page.getByRole('button', { name: /last hour/i });
    await expect(hourButton).toHaveAttribute('data-selected', 'true');

    // Click 24h
    await page.getByRole('button', { name: /last 24 hours/i }).click();

    // 24h should now be selected
    await expect(page.getByRole('button', { name: /last 24 hours/i })).toHaveAttribute(
      'data-selected',
      'true',
    );
    await expect(hourButton).toHaveAttribute('data-selected', 'false');
  });

  test('should filter logs by time range', async ({ page }) => {
    // Ingest a log
    await ingestLog(page, testProject.apiKey, {
      level: 'info',
      message: 'Recent log message',
    });

    await page.goto(`/projects/${testProject.id}`);

    // Should show recent log with 15m filter (scoped to table layout)
    await page.getByRole('button', { name: /last 15 minutes/i }).click();
    await expect(getLogMessage(page, 'Recent log message')).toBeVisible();
  });
});

test.describe('Log Stream Page - Log Detail Modal', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `detail-modal-test-${Date.now()}`);

    // Ingest a log with all fields
    await ingestLog(page, testProject.apiKey, {
      level: 'error',
      message: 'Detailed error for testing',
      metadata: { key: 'value', nested: { foo: 'bar' } },
      source_file: 'src/test.ts',
      line_number: 42,
      request_id: 'req_abc123',
      user_id: 'user_456',
      ip_address: '192.168.1.100',
    });
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should open detail modal when clicking log row', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Wait for log to appear (scoped to table layout)
    await expect(getLogMessage(page, 'Detailed error for testing')).toBeVisible();

    // Click on the log row (scoped to table layout)
    await getLogMessage(page, 'Detailed error for testing').click();

    // Modal should open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Log Details')).toBeVisible();
  });

  test('should display all log fields in detail modal', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Wait for log to be visible then click on the row
    const logMessage = getLogMessage(page, 'Detailed error for testing');
    await expect(logMessage).toBeVisible();
    await logMessage.click();

    // Wait for modal to open
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Verify all fields are displayed (scoped to modal to avoid matching table/card elements)
    // Note: Some values appear both in dedicated fields AND in metadata JSON, so use .first()
    await expect(modal.getByText('Detailed error for testing')).toBeVisible();
    await expect(modal.getByText('src/test.ts:42')).toBeVisible();
    await expect(modal.getByText('req_abc123').first()).toBeVisible();
    await expect(modal.getByText('user_456').first()).toBeVisible();
    await expect(modal.getByText('192.168.1.100').first()).toBeVisible();

    // Metadata should be pretty-printed
    await expect(page.locator('[data-testid="log-metadata"]')).toContainText('"key": "value"');
  });

  test('should close modal on Escape key', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Open modal (scoped to table layout)
    await getLogMessage(page, 'Detailed error for testing').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should close modal on overlay click', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Open modal (scoped to table layout)
    await getLogMessage(page, 'Detailed error for testing').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click overlay
    await page.locator('[data-testid="modal-overlay"]').click({ position: { x: 10, y: 10 } });

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});

test.describe('Log Stream Page - Project Settings Modal', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `settings-modal-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should open settings modal when clicking settings button', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Find and click settings button
    const settingsButton = page.getByRole('button', { name: /settings/i });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();

    // Settings modal should open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Project Settings')).toBeVisible();
  });

  test('should display API key in settings modal', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Open settings modal
    await page.getByRole('button', { name: /settings/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // API key should be displayed
    await expect(page.locator('[data-testid="api-key-display"]')).toContainText('lw_');
  });

  test('should show curl example in settings modal', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Open settings modal
    await page.getByRole('button', { name: /settings/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Curl example should be visible (curl is selected by default)
    await expect(page.locator('[data-testid="example-code"]')).toContainText('curl');
    await expect(page.locator('[data-testid="example-code"]')).toContainText('Authorization');
  });

  test('should close settings modal on Escape', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Open settings modal
    await page.getByRole('button', { name: /settings/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});

test.describe('Log Stream Page - Empty State', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `empty-state-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should show empty state when no logs exist', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Should show empty message - wait for log table to load, then check desktop table empty state
    await expect(page.locator('[data-testid="log-table"]')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'No logs yet' })).toBeVisible();
  });
});

test.describe('Log Stream Page - Navigation', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `navigation-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should have back button to dashboard', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Back button should be visible
    const backButton = page.getByRole('link', { name: /back|dashboard|home/i });
    await expect(backButton).toBeVisible();

    // Click should navigate to dashboard
    await backButton.click();
    await expect(page).toHaveURL('/');
  });
});
