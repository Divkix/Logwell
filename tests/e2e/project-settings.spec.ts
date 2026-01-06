import { expect, type Page, test } from '@playwright/test';

/**
 * E2E tests for Project Settings Page
 *
 * Phase 10 from the auto-delete implementation plan
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
 * Helper to get all projects and delete them
 */
async function cleanupProjects(page: Page) {
  const response = await page.request.get('/api/projects');
  if (response.ok()) {
    const { projects } = await response.json();
    for (const project of projects) {
      await deleteProject(page, project.id);
    }
  }
}

test.describe('Project Settings - Navigation', () => {
  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    testProject = await createProject(page, 'settings-test-project');
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should navigate to settings page from bottom nav', async ({ page }) => {
    // Navigate to project page first
    await page.goto(`/projects/${testProject.id}`);

    // Click settings in bottom nav (visible on mobile)
    await page.setViewportSize({ width: 375, height: 667 });
    const settingsLink = page.getByTestId('nav-settings');
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();

    // Should be on settings page
    await expect(page).toHaveURL(`/projects/${testProject.id}/settings`);
    await expect(page.getByRole('heading', { name: /project settings/i })).toBeVisible();
  });

  test('should navigate back to project from settings', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/settings`);

    // Click back link
    const backLink = page.getByRole('link', { name: /back to project/i });
    await expect(backLink).toBeVisible();
    await backLink.click();

    // Should be on project page
    await expect(page).toHaveURL(`/projects/${testProject.id}`);
  });
});

test.describe('Project Settings - General Section', () => {
  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    testProject = await createProject(page, 'general-settings-test');
    await page.goto(`/projects/${testProject.id}/settings`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should display project name', async ({ page }) => {
    await expect(page.getByTestId('project-name-display')).toHaveText(testProject.name);
  });

  test('should edit project name', async ({ page }) => {
    // Click edit button
    await page.getByTestId('edit-name-button').click();

    // Input should appear with current name
    const input = page.getByTestId('project-name-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(testProject.name);

    // Clear and type new name
    await input.clear();
    await input.fill('renamed-project');

    // Save
    await page.getByTestId('save-name-button').click();

    // Should update display
    await expect(page.getByTestId('project-name-display')).toHaveText('renamed-project');

    // Update for cleanup
    testProject.name = 'renamed-project';
  });

  test('should cancel name editing', async ({ page }) => {
    await page.getByTestId('edit-name-button').click();

    const input = page.getByTestId('project-name-input');
    await input.clear();
    await input.fill('should-not-save');

    // Click cancel
    await page.getByTestId('cancel-edit-button').click();

    // Should show original name
    await expect(page.getByTestId('project-name-display')).toHaveText(testProject.name);
  });

  test('should show validation error for empty name', async ({ page }) => {
    await page.getByTestId('edit-name-button').click();

    const input = page.getByTestId('project-name-input');
    await input.clear();

    // Save with empty name
    await page.getByTestId('save-name-button').click();

    // Should show error
    await expect(page.getByTestId('name-error')).toBeVisible();
    await expect(page.getByTestId('name-error')).toContainText(/cannot be empty/i);
  });

  test('should show validation error for invalid characters', async ({ page }) => {
    await page.getByTestId('edit-name-button').click();

    const input = page.getByTestId('project-name-input');
    await input.clear();
    await input.fill('invalid name with spaces');

    await page.getByTestId('save-name-button').click();

    await expect(page.getByTestId('name-error')).toBeVisible();
    await expect(page.getByTestId('name-error')).toContainText(/alphanumeric/i);
  });
});

test.describe('Project Settings - API Key Section', () => {
  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    testProject = await createProject(page, 'apikey-settings-test');
    await page.goto(`/projects/${testProject.id}/settings`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should display API key', async ({ page }) => {
    const apiKeyDisplay = page.getByTestId('api-key-display');
    await expect(apiKeyDisplay).toBeVisible();
    await expect(apiKeyDisplay).toContainText(testProject.apiKey);
  });

  test('should copy API key to clipboard', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.getByTestId('copy-api-key-button').click();

    // Verify clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(testProject.apiKey);
  });

  test('should show regenerate confirmation dialog', async ({ page }) => {
    await page.getByTestId('regenerate-button').click();

    // Dialog should appear
    const dialog = page.getByTestId('regenerate-confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/regenerate api key/i)).toBeVisible();
    await expect(dialog.getByText(/invalidate/i)).toBeVisible();
  });

  test('should cancel regeneration', async ({ page }) => {
    await page.getByTestId('regenerate-button').click();
    await page.getByTestId('cancel-regenerate-button').click();

    // Dialog should close
    await expect(page.getByTestId('regenerate-confirm-dialog')).not.toBeVisible();

    // API key should be unchanged
    await expect(page.getByTestId('api-key-display')).toContainText(testProject.apiKey);
  });

  test('should regenerate API key', async ({ page }) => {
    const originalApiKey = testProject.apiKey;

    await page.getByTestId('regenerate-button').click();
    await page.getByTestId('confirm-regenerate-button').click();

    // Dialog should close
    await expect(page.getByTestId('regenerate-confirm-dialog')).not.toBeVisible();

    // API key should be different
    const apiKeyDisplay = page.getByTestId('api-key-display');
    await expect(apiKeyDisplay).not.toContainText(originalApiKey);
  });
});

test.describe('Project Settings - Log Retention Section', () => {
  let testProject: { id: string; name: string; apiKey: string; retentionDays: number | null };

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    testProject = await createProject(page, 'retention-settings-test');
    await page.goto(`/projects/${testProject.id}/settings`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should display retention selector with system default', async ({ page }) => {
    const selector = page.getByTestId('retention-selector');
    await expect(selector).toBeVisible();

    // Default should be system default
    await expect(selector).toContainText(/system default/i);
  });

  test('should display log statistics', async ({ page }) => {
    // Stats section should show total logs and oldest log
    await expect(page.getByText(/total logs/i)).toBeVisible();
    await expect(page.getByText(/oldest log/i)).toBeVisible();
    await expect(page.getByText(/effective retention/i)).toBeVisible();
  });

  test('should change retention to 30 days', async ({ page }) => {
    // Open selector
    await page.getByTestId('retention-selector').click();

    // Select 30 days option
    await page.getByTestId('retention-option-30').click();

    // Wait for update
    await page.waitForTimeout(500);

    // Selector should show 30 days
    await expect(page.getByTestId('retention-selector')).toContainText('30 days');
  });

  test('should change retention to never delete', async ({ page }) => {
    await page.getByTestId('retention-selector').click();
    await page.getByTestId('retention-option-0').click();

    await page.waitForTimeout(500);

    await expect(page.getByTestId('retention-selector')).toContainText(/never delete/i);
  });

  test('should persist retention changes after page reload', async ({ page }) => {
    // Change retention
    await page.getByTestId('retention-selector').click();
    await page.getByTestId('retention-option-90').click();
    await page.waitForTimeout(500);

    // Reload page
    await page.reload();

    // Should still show 90 days
    await expect(page.getByTestId('retention-selector')).toContainText('90 days');
  });
});

test.describe('Project Settings - Danger Zone', () => {
  let testProject: { id: string; name: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    testProject = await createProject(page, 'delete-test-project');
    await page.goto(`/projects/${testProject.id}/settings`);
  });

  // No afterEach cleanup needed - project should be deleted

  test('should show delete button in danger zone', async ({ page }) => {
    await expect(page.getByTestId('delete-project-button')).toBeVisible();
    await expect(page.getByText(/danger zone/i)).toBeVisible();
  });

  test('should show delete confirmation dialog', async ({ page }) => {
    await page.getByTestId('delete-project-button').click();

    const dialog = page.getByTestId('delete-confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /delete project/i })).toBeVisible();
    await expect(dialog.getByText(/cannot be undone/i)).toBeVisible();
  });

  test('should require type-to-confirm before delete', async ({ page }) => {
    await page.getByTestId('delete-project-button').click();

    // Delete button should be disabled initially
    const confirmButton = page.getByTestId('confirm-delete-button');
    await expect(confirmButton).toBeDisabled();

    // Type wrong name
    await page.getByTestId('delete-confirm-input').fill('wrong-name');
    await expect(confirmButton).toBeDisabled();

    // Type correct name
    await page.getByTestId('delete-confirm-input').fill(testProject.name);
    await expect(confirmButton).toBeEnabled();
  });

  test('should cancel deletion', async ({ page }) => {
    await page.getByTestId('delete-project-button').click();
    await page.getByTestId('cancel-delete-button').click();

    // Dialog should close
    await expect(page.getByTestId('delete-confirm-dialog')).not.toBeVisible();
  });

  test('should delete project and redirect to home', async ({ page }) => {
    await page.getByTestId('delete-project-button').click();
    await page.getByTestId('delete-confirm-input').fill(testProject.name);
    await page.getByTestId('confirm-delete-button').click();

    // Should redirect to home
    await expect(page).toHaveURL('/', { timeout: 10000 });

    // Project should not exist anymore (mark as deleted)
    testProject.id = '';
  });

  test('should copy project name in delete dialog', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.getByTestId('delete-project-button').click();
    await page.getByTestId('copy-project-name-button').click();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(testProject.name);
  });
});

test.describe('Project Settings - Quick Start Section', () => {
  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    testProject = await createProject(page, 'quickstart-test');
    await page.goto(`/projects/${testProject.id}/settings`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should display curl example by default', async ({ page }) => {
    const codeBlock = page.getByTestId('example-code');
    await expect(codeBlock).toBeVisible();
    await expect(codeBlock).toContainText('curl');
    await expect(codeBlock).toContainText(testProject.apiKey);
  });

  test('should switch to TypeScript example', async ({ page }) => {
    await page.getByTestId('example-selector').click();
    await page.getByTestId('example-option-typescript').click();

    const codeBlock = page.getByTestId('example-code');
    await expect(codeBlock).toContainText('import');
    await expect(codeBlock).toContainText('Logwell');
    await expect(codeBlock).toContainText(testProject.apiKey);
  });

  test('should switch to JSR example', async ({ page }) => {
    await page.getByTestId('example-selector').click();
    await page.getByTestId('example-option-jsr').click();

    const codeBlock = page.getByTestId('example-code');
    await expect(codeBlock).toContainText('@divkix/logwell');
    await expect(codeBlock).toContainText(testProject.apiKey);
  });

  test('should copy example code to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.getByTestId('copy-example-button').click();

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('curl');
    expect(clipboardText).toContain(testProject.apiKey);
  });
});

test.describe('Project Settings - Layout', () => {
  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    testProject = await createProject(page, 'layout-test-project');
    await page.goto(`/projects/${testProject.id}/settings`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should display 2-column grid on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    const grid = page.getByTestId('settings-grid');
    await expect(grid).toBeVisible();

    // Verify grid has 2 columns by checking CSS
    const gridStyle = await grid.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return computed.gridTemplateColumns;
    });

    // Should have 2 equal columns (e.g., "400px 400px" or similar)
    const columns = gridStyle.split(' ').filter((c) => c !== '');
    expect(columns.length).toBe(2);
  });

  test('should stack to single column on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const grid = page.getByTestId('settings-grid');
    await expect(grid).toBeVisible();

    // Verify grid has 1 column on mobile
    const gridStyle = await grid.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return computed.gridTemplateColumns;
    });

    const columns = gridStyle.split(' ').filter((c) => c !== '');
    expect(columns.length).toBe(1);
  });

  test('should keep danger zone full-width outside grid', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    const dangerZone = page.getByTestId('danger-zone');
    await expect(dangerZone).toBeVisible();

    // Danger zone should NOT be inside the grid
    const isInsideGrid = await dangerZone.evaluate((el) => {
      return el.closest('[data-testid="settings-grid"]') !== null;
    });
    expect(isInsideGrid).toBe(false);
  });

  test('should have correct section order in grid', async ({ page }) => {
    const grid = page.getByTestId('settings-grid');
    const sections = grid.locator('section');

    // 4 sections in grid (General, API Key, Quick Start, Log Retention)
    await expect(sections).toHaveCount(4);

    // Verify order by checking headings
    const headings = await sections.locator('h2').allTextContents();
    expect(headings[0]).toContain('General');
    expect(headings[1]).toContain('API Key');
    expect(headings[2]).toContain('Quick Start');
    expect(headings[3]).toContain('Log Retention');
  });
});
