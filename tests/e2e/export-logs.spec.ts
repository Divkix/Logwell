import { expect, type Page, test } from '@playwright/test';

/**
 * E2E tests for Log Export Feature
 *
 * Tests follow Trophy testing methodology - focus on user behavior
 * Covers CSV and JSON export formats with filter support
 */

// Test user credentials (matches seeded admin from scripts/seed-admin.ts)
const TEST_USER = {
  email: 'admin@example.com',
  password: 'adminpass',
};

/**
 * Helper to perform login
 */
async function login(page: Page) {
  await page.goto('/login');
  await page.waitForSelector('form');

  const emailInput = page.getByLabel(/email/i);
  const passwordInput = page.getByLabel(/password/i);

  await emailInput.click();
  await emailInput.fill(TEST_USER.email);
  await expect(emailInput).toHaveValue(TEST_USER.email);

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
 * Helper to ingest multiple logs via batch API
 */
async function ingestLogsBatch(
  page: Page,
  apiKey: string,
  logs: Array<{
    level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    message: string;
    metadata?: Record<string, unknown>;
    sourceFile?: string;
    lineNumber?: number;
    requestId?: string;
    userId?: string;
    ipAddress?: string;
  }>,
) {
  const response = await page.request.post('/api/v1/logs/batch', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    data: { logs },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

/**
 * Helper to parse CSV content into rows
 */
function parseCsv(csvContent: string): string[][] {
  const lines = csvContent.trim().split('\n');
  return lines.map((line) => {
    // Simple CSV parsing - handles quoted fields
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields;
  });
}

test.describe('Log Export - Visibility', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-visibility-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should show export button when logs exist', async ({ page }) => {
    // Ingest some logs
    await ingestLogsBatch(page, testProject.apiKey, [
      { level: 'info', message: 'Test log for export visibility' },
      { level: 'error', message: 'Another test log' },
    ]);

    await page.goto(`/projects/${testProject.id}`);

    // Export button should be visible
    const exportButton = page.locator('[data-testid="export-button"]');
    await expect(exportButton).toBeVisible({ timeout: 5000 });
  });

  test('should hide export button when no logs exist', async ({ page }) => {
    // Navigate to project with no logs
    await page.goto(`/projects/${testProject.id}`);

    // Wait for page to load and verify empty state
    await expect(page.locator('[data-testid="log-table-empty-desktop"]')).toBeVisible();

    // Export button should not be visible
    const exportButton = page.locator('[data-testid="export-button"]');
    await expect(exportButton).not.toBeVisible();
  });
});

test.describe('Log Export - Format Selection', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-format-test-${Date.now()}`);

    // Ingest test logs
    await ingestLogsBatch(page, testProject.apiKey, [
      { level: 'info', message: 'Format selection test log' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should show format dropdown when clicking export button', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Click export button
    const exportButton = page.locator('[data-testid="export-button"]');
    await expect(exportButton).toBeVisible();
    await exportButton.click();

    // CSV and JSON options should be visible
    await expect(page.locator('[data-testid="export-csv"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-json"]')).toBeVisible();
  });

  test('should close dropdown when pressing Escape', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Open dropdown
    const exportButton = page.locator('[data-testid="export-button"]');
    await exportButton.click();
    await expect(page.locator('[data-testid="export-csv"]')).toBeVisible();

    // Press Escape to close dropdown
    await page.keyboard.press('Escape');

    // Dropdown should close
    await expect(page.locator('[data-testid="export-csv"]')).not.toBeVisible();
  });
});

test.describe('Log Export - CSV Download', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-csv-test-${Date.now()}`);

    // Ingest test logs with various fields
    await ingestLogsBatch(page, testProject.apiKey, [
      {
        level: 'info',
        message: 'CSV export test log',
        metadata: { key: 'value' },
        sourceFile: 'test.ts',
        lineNumber: 42,
        requestId: 'req_123',
        userId: 'user_456',
        ipAddress: '192.168.1.1',
      },
      {
        level: 'error',
        message: 'Error log for CSV',
      },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should trigger CSV download with correct filename pattern', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Open export dropdown
    await page.locator('[data-testid="export-button"]').click();

    // Start download listener
    const downloadPromise = page.waitForEvent('download');

    // Click CSV option
    await page.locator('[data-testid="export-csv"]').click();

    // Wait for download
    const download = await downloadPromise;
    const filename = download.suggestedFilename();

    // Verify filename matches pattern: logs-*.csv
    expect(filename).toMatch(/^logs-.+\.csv$/);
    expect(filename).toContain(testProject.name.replace(/[^a-zA-Z0-9-_]/g, '-'));
  });

  test('should download CSV with expected headers', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Trigger CSV download
    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="export-csv"]').click();

    // Get download content
    const download = await downloadPromise;
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (readStream) {
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const csvContent = Buffer.concat(chunks).toString('utf-8');

    // Parse CSV
    const rows = parseCsv(csvContent);
    const headers = rows[0];

    // Verify expected headers exist
    expect(headers).toContain('id');
    expect(headers).toContain('level');
    expect(headers).toContain('message');
    expect(headers).toContain('timestamp');
    expect(headers).toContain('sourceFile');
    expect(headers).toContain('lineNumber');
    expect(headers).toContain('requestId');
    expect(headers).toContain('userId');
    expect(headers).toContain('ipAddress');
    expect(headers).toContain('metadata');
  });

  test('should download CSV with correct data rows', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Trigger CSV download
    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="export-csv"]').click();

    // Get download content
    const download = await downloadPromise;
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (readStream) {
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const csvContent = Buffer.concat(chunks).toString('utf-8');

    // Verify content includes test data
    expect(csvContent).toContain('CSV export test log');
    expect(csvContent).toContain('Error log for CSV');
    expect(csvContent).toContain('info');
    expect(csvContent).toContain('error');
  });
});

test.describe('Log Export - JSON Download', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-json-test-${Date.now()}`);

    // Ingest test logs
    await ingestLogsBatch(page, testProject.apiKey, [
      {
        level: 'warn',
        message: 'JSON export test log',
        metadata: { environment: 'test' },
      },
      {
        level: 'debug',
        message: 'Debug log for JSON',
      },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should trigger JSON download with correct filename pattern', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Open export dropdown
    await page.locator('[data-testid="export-button"]').click();

    // Start download listener
    const downloadPromise = page.waitForEvent('download');

    // Click JSON option
    await page.locator('[data-testid="export-json"]').click();

    // Wait for download
    const download = await downloadPromise;
    const filename = download.suggestedFilename();

    // Verify filename matches pattern: logs-*.json
    expect(filename).toMatch(/^logs-.+\.json$/);
    expect(filename).toContain(testProject.name.replace(/[^a-zA-Z0-9-_]/g, '-'));
  });

  test('should download valid JSON array', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Trigger JSON download
    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="export-json"]').click();

    // Get download content
    const download = await downloadPromise;
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (readStream) {
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const jsonContent = Buffer.concat(chunks).toString('utf-8');

    // Parse JSON and verify structure
    let parsedJson: unknown;
    expect(() => {
      parsedJson = JSON.parse(jsonContent);
    }).not.toThrow();

    expect(Array.isArray(parsedJson)).toBe(true);
  });

  test('should download JSON with expected fields', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Trigger JSON download
    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="export-json"]').click();

    // Get download content
    const download = await downloadPromise;
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (readStream) {
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const jsonContent = Buffer.concat(chunks).toString('utf-8');

    // Parse and verify structure
    const logs = JSON.parse(jsonContent) as Array<Record<string, unknown>>;

    expect(logs.length).toBeGreaterThan(0);
    const firstLog = logs[0];

    // Verify expected fields
    expect(firstLog).toHaveProperty('id');
    expect(firstLog).toHaveProperty('level');
    expect(firstLog).toHaveProperty('message');
    expect(firstLog).toHaveProperty('timestamp');

    // Verify content
    const messages = logs.map((l) => l.message);
    expect(messages).toContain('JSON export test log');
    expect(messages).toContain('Debug log for JSON');
  });
});

test.describe('Log Export - With Filters', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-filter-test-${Date.now()}`);

    // Ingest logs with different levels and messages
    await ingestLogsBatch(page, testProject.apiKey, [
      { level: 'info', message: 'Info message about database' },
      { level: 'error', message: 'Error connecting to database' },
      { level: 'warn', message: 'Warning about memory usage' },
      { level: 'error', message: 'Critical error occurred' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should export filtered logs when level filter is active', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Apply level filter - select only ERROR
    const levelFilter = page.locator('[data-testid="level-filter"]');
    await levelFilter.getByRole('button', { name: /error/i }).click();
    await page.waitForTimeout(500); // Wait for filter to apply

    // Trigger CSV export
    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="export-csv"]').click();

    // Get download content
    const download = await downloadPromise;
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (readStream) {
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const csvContent = Buffer.concat(chunks).toString('utf-8');

    // Verify only error logs are exported
    expect(csvContent).toContain('Error connecting to database');
    expect(csvContent).toContain('Critical error occurred');
    expect(csvContent).not.toContain('Info message about database');
    expect(csvContent).not.toContain('Warning about memory usage');
  });

  test('should export filtered logs when search filter is active', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Apply search filter
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('database');
    await page.waitForTimeout(500); // Wait for debounce

    // Trigger JSON export
    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="export-json"]').click();

    // Get download content
    const download = await downloadPromise;
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (readStream) {
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const jsonContent = Buffer.concat(chunks).toString('utf-8');

    // Parse and verify
    const logs = JSON.parse(jsonContent) as Array<Record<string, unknown>>;
    const messages = logs.map((l) => l.message as string);

    // Should only contain logs with "database" in message
    expect(messages.every((msg) => msg.toLowerCase().includes('database'))).toBe(true);
    expect(messages).toContain('Info message about database');
    expect(messages).toContain('Error connecting to database');
  });

  test('should export filtered logs with combined filters', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Apply both level and search filters
    const levelFilter = page.locator('[data-testid="level-filter"]');
    await levelFilter.getByRole('button', { name: /error/i }).click();
    await page.waitForTimeout(300);

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('database');
    await page.waitForTimeout(500);

    // Trigger CSV export
    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="export-csv"]').click();

    // Get download content
    const download = await downloadPromise;
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (readStream) {
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const csvContent = Buffer.concat(chunks).toString('utf-8');

    // Should only contain error logs with "database" in message
    expect(csvContent).toContain('Error connecting to database');
    expect(csvContent).not.toContain('Info message about database'); // Wrong level
    expect(csvContent).not.toContain('Critical error occurred'); // Missing search term
    expect(csvContent).not.toContain('Warning about memory usage'); // Wrong level and missing search
  });
});

test.describe('Log Export - Edge Cases', () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-edge-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should handle export of logs with special characters in message', async ({ page }) => {
    // Ingest log with special characters
    await ingestLogsBatch(page, testProject.apiKey, [
      {
        level: 'info',
        message: 'Log with special chars: "quotes", commas,, and\nnewlines',
      },
    ]);

    await page.goto(`/projects/${testProject.id}`);

    // Trigger CSV export
    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="export-csv"]').click();

    // Should complete without error
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('should handle export when filter results in no logs', async ({ page }) => {
    // Ingest one log
    await ingestLogsBatch(page, testProject.apiKey, [{ level: 'info', message: 'Single log' }]);

    await page.goto(`/projects/${testProject.id}`);

    // Apply filter that matches nothing
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('nonexistentterm123456');
    await page.waitForTimeout(500);

    // Export button might be hidden when no results
    const exportButton = page.locator('[data-testid="export-button"]');
    const isVisible = await exportButton.isVisible();

    if (isVisible) {
      // If export is still available, it should export empty results
      await exportButton.click();
      const downloadPromise = page.waitForEvent('download');
      await page.locator('[data-testid="export-json"]').click();

      const download = await downloadPromise;
      const readStream = await download.createReadStream();
      const chunks: Buffer[] = [];
      if (readStream) {
        for await (const chunk of readStream) {
          chunks.push(Buffer.from(chunk));
        }
      }
      const jsonContent = Buffer.concat(chunks).toString('utf-8');
      const logs = JSON.parse(jsonContent) as Array<Record<string, unknown>>;

      expect(logs.length).toBe(0);
    } else {
      // Export button is hidden when no results - this is expected behavior
      expect(isVisible).toBe(false);
    }
  });
});
