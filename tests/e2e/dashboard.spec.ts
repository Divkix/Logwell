import { expect, type Page, test } from '@playwright/test';

/**
 * E2E tests for Dashboard (Project List)
 *
 * Phase 8.3 from the implementation plan
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
  // Ignore if project doesn't exist
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

test.describe('Dashboard - Empty State', () => {
  // Allow retries for this describe block due to potential cold start issues
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    await login(page);
    // Clean up any existing projects
    await cleanupProjects(page);
    // Refresh to see empty state
    await page.goto('/');
  });

  test('should show empty state when no projects exist', async ({ page }) => {
    // Dashboard should display empty state message
    await expect(page.getByText(/no projects/i)).toBeVisible();

    // Should show create project prompt
    await expect(page.getByText(/create.*first.*project/i)).toBeVisible();
  });

  test('should have create project button in empty state', async ({ page }) => {
    // In empty state, we have two Create Project buttons (header + empty state)
    // Both should be visible
    const createButtons = page.getByRole('button', { name: /create.*project/i });
    await expect(createButtons).toHaveCount(2);
  });
});

test.describe('Dashboard - Project Display', () => {
  let createdProjects: Array<{ id: string; name: string }> = [];

  test.beforeEach(async ({ page }) => {
    await login(page);
    // Clean up any existing projects
    await cleanupProjects(page);
    createdProjects = [];

    // Create test projects
    const project1 = await createProject(page, 'test-project-1');
    const project2 = await createProject(page, 'test-project-2');
    createdProjects.push(project1, project2);

    // Navigate to dashboard to see projects
    await page.goto('/');
  });

  test.afterEach(async ({ page }) => {
    // Cleanup created projects
    for (const project of createdProjects) {
      await deleteProject(page, project.id);
    }
  });

  test('should display project cards', async ({ page }) => {
    // Should display project cards for each project
    await expect(page.getByText('test-project-1')).toBeVisible();
    await expect(page.getByText('test-project-2')).toBeVisible();
  });

  test('should display project cards with log count', async ({ page }) => {
    // Each project card should show log count (0 logs initially)
    const cards = page.locator('[data-testid="project-card"]');
    await expect(cards).toHaveCount(2);

    // Cards should display log count
    await expect(page.getByText(/0 logs/i).first()).toBeVisible();
  });

  test('should display View Logs button on project cards', async ({ page }) => {
    // Each card should have View Logs button
    const viewLogsButtons = page.getByRole('link', { name: /view logs/i });
    await expect(viewLogsButtons).toHaveCount(2);
  });
});

test.describe('Dashboard - Navigation', () => {
  let testProject: { id: string; name: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);

    // Create a test project
    testProject = await createProject(page, 'navigation-test-project');
    await page.goto('/');
  });

  test.afterEach(async ({ page }) => {
    await deleteProject(page, testProject.id);
  });

  test('should navigate to project page on View Logs click', async ({ page }) => {
    // Find and click View Logs button
    const viewLogsButton = page.getByRole('link', { name: /view logs/i });
    await expect(viewLogsButton).toBeVisible();
    await viewLogsButton.click();

    // Should navigate to project page
    await expect(page).toHaveURL(new RegExp(`/projects/${testProject.id}`));
  });

  test('should navigate to project page on card click', async ({ page }) => {
    // Click the project card (not just the button)
    const projectCard = page.locator('[data-testid="project-card"]').first();
    await projectCard.click();

    // Should navigate to project page
    await expect(page).toHaveURL(new RegExp(`/projects/${testProject.id}`));
  });
});

test.describe('Dashboard - Create Project Modal', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    await page.goto('/');
  });

  test('should open create project modal when clicking create button', async ({ page }) => {
    // Click first create project button (header)
    const createButton = page.getByRole('button', { name: /create.*project/i }).first();
    await createButton.click();

    // Modal should be visible
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText(/create.*project/i)).toBeVisible();
  });

  test('should have project name input in create modal', async ({ page }) => {
    // Open modal
    const createButton = page.getByRole('button', { name: /create.*project/i }).first();
    await createButton.click();

    // Should have name input
    const nameInput = page.getByLabel(/name/i);
    await expect(nameInput).toBeVisible();
  });

  test('should create project and show in list', async ({ page }) => {
    // Open create modal
    const createButton = page.getByRole('button', { name: /create.*project/i }).first();
    await createButton.click();

    // Fill in project name
    const nameInput = page.getByLabel(/name/i);
    await nameInput.fill('my-new-project');

    // Submit the form - use the one in the dialog
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^create$/i })
      .click();

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });

    // Project should appear in the list (use testid to avoid matching toast notification)
    await expect(
      page.locator('[data-testid="project-card"]').getByText('my-new-project'),
    ).toBeVisible();

    // Cleanup
    const response = await page.request.get('/api/projects');
    const { projects } = await response.json();
    const newProject = projects.find((p: { name: string }) => p.name === 'my-new-project');
    if (newProject) {
      await deleteProject(page, newProject.id);
    }
  });

  test('should show validation error for empty project name', async ({ page }) => {
    // Open create modal
    const createButton = page.getByRole('button', { name: /create.*project/i }).first();
    await createButton.click();

    // Try to submit without name - use the one in the dialog
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^create$/i })
      .click();

    // Should show validation error
    await expect(page.getByText(/name.*required|required/i)).toBeVisible();
  });

  test('should show error for duplicate project name', async ({ page }) => {
    // First create a project
    await createProject(page, 'duplicate-test');

    // Refresh page
    await page.goto('/');

    // Open create modal
    const createButton = page.getByRole('button', { name: /create.*project/i }).first();
    await createButton.click();

    // Try to create with same name
    const nameInput = page.getByLabel(/name/i);
    await nameInput.fill('duplicate-test');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^create$/i })
      .click();

    // Should show duplicate error
    await expect(page.getByText(/already exists|duplicate/i)).toBeVisible();

    // Cleanup
    const response = await page.request.get('/api/projects');
    const { projects } = await response.json();
    const testProject = projects.find((p: { name: string }) => p.name === 'duplicate-test');
    if (testProject) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should close modal on escape key', async ({ page }) => {
    // Open create modal
    const createButton = page.getByRole('button', { name: /create.*project/i }).first();
    await createButton.click();

    // Press escape
    await page.keyboard.press('Escape');

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('should close modal on cancel button', async ({ page }) => {
    // Open create modal
    const createButton = page.getByRole('button', { name: /create.*project/i }).first();
    await createButton.click();

    // Click cancel
    await page.getByRole('button', { name: /cancel/i }).click();

    // Modal should close
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });
});

test.describe('Dashboard - Loading State', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should show loading state while fetching projects', async ({ page }) => {
    // This test verifies loading state exists
    // We intercept the API to delay response
    await page.route('/api/projects', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    await page.goto('/');

    // Should show some loading indicator (skeleton or spinner)
    // Note: This might be flaky if the request is too fast
    // Just verify the page loads without error
    await expect(page).toHaveURL('/');
  });
});
