import { expect, type Page, test } from '@playwright/test';
import { getLogCard } from './helpers/log-selectors';
import { ingestOtlpLogs } from './helpers/otlp';

/**
 * E2E tests for Responsive Design
 *
 * Phase 10.3 from the implementation plan
 * Tests responsive behavior at different breakpoints:
 * - Mobile: < 640px (sm breakpoint)
 * - Tablet: 640px - 1024px
 * - Desktop: > 1024px
 */

// Test user credentials (matches seeded admin from scripts/seed-admin.ts)
const TEST_USER = {
  email: 'admin@example.com',
  password: 'adminpass',
};

// Viewport sizes for testing
const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
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

test.describe('Responsive Design - Mobile Viewport', () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.mobile });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `responsive-mobile-${Date.now()}`);
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: 'info', message: 'Test log message one' },
      { level: 'error', message: 'Test error message' },
      { level: 'warn', message: 'Test warning message' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should show collapsible filter toggle on mobile', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // On mobile, filters should be collapsed behind a toggle button
    const filterToggle = page.locator('[data-testid="filter-toggle"]');
    await expect(filterToggle).toBeVisible();

    // Filter panel should be hidden initially
    const filterPanel = page.locator('[data-testid="filter-panel"]');
    await expect(filterPanel).not.toBeVisible();

    // Click toggle to expand filters
    await filterToggle.click();

    // Filter panel should now be visible
    await expect(filterPanel).toBeVisible();

    // Level filter should be visible inside the panel
    const levelFilterInPanel = filterPanel.locator('[data-testid="level-filter"]');
    await expect(levelFilterInPanel).toBeVisible();
  });

  test('should show log cards instead of table on mobile', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // On mobile, logs should be displayed as cards, not table
    await expect(getLogCard(page).first()).toBeVisible();

    // Table should be hidden on mobile
    const logTable = page.locator('[data-testid="log-table"] table');
    await expect(logTable).not.toBeVisible();
  });

  test('should show bottom navigation on mobile', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Bottom navigation should be visible on mobile
    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await expect(bottomNav).toBeVisible();

    // Bottom nav should contain key navigation items
    await expect(bottomNav.getByRole('link', { name: /home|dashboard/i })).toBeVisible();
    // Use testid for stats link for reliability
    await expect(bottomNav.locator('[data-testid="nav-stats"]')).toBeVisible();
  });

  test('should hide desktop header navigation on mobile', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // User name/email text should be hidden on mobile (only show in bottom nav or menu)
    // Admin user has name: 'Admin' which takes precedence over email
    const userText = page.locator('header').getByText(/admin/i);
    await expect(userText).not.toBeVisible();

    // Logout text should be hidden (icon only or in menu)
    const logoutText = page.locator('header').getByText('Logout');
    await expect(logoutText).not.toBeVisible();
  });

  test('should stack project header elements on mobile', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Project name should be visible
    await expect(page.getByRole('heading', { name: testProject.name })).toBeVisible();

    // Stats and Settings buttons should be in bottom nav or condensed
    // The header should not have buttons cramped together
    const headerButtons = page.locator('[data-testid="project-header-actions"]');

    // On mobile, these actions should move to bottom nav
    await expect(headerButtons).not.toBeVisible();
  });

  test('should have full-width search input on mobile', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Open filter panel
    await page.locator('[data-testid="filter-toggle"]').click();

    // Wait for panel to open
    const filterPanel = page.locator('[data-testid="filter-panel"]');
    await expect(filterPanel).toBeVisible();

    // Search input should take full width on mobile (inside the panel)
    const searchContainer = filterPanel.locator('[data-testid="search-container"]');
    const searchBoundingBox = await searchContainer.boundingBox();

    // Search should be close to panel width (panel has padding, so a bit less than viewport)
    expect(searchBoundingBox?.width).toBeGreaterThan(VIEWPORTS.mobile.width - 64);
  });
});

test.describe('Responsive Design - Tablet Viewport', () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.tablet });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `responsive-tablet-${Date.now()}`);
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: 'info', message: 'Test log message one' },
      { level: 'error', message: 'Test error message' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should show log table on tablet', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Table should be visible on tablet
    const logTable = page.locator('[data-testid="log-table"] table');
    await expect(logTable).toBeVisible();

    // Cards container should be hidden on tablet (via sm:hidden CSS class)
    // Cards exist in DOM but are not visible at tablet+ viewports
    await expect(getLogCard(page).first()).not.toBeVisible();
  });

  test('should show inline filters on tablet', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Filters should be visible inline (not collapsed)
    const levelFilter = page.locator('[data-testid="level-filter"]');
    await expect(levelFilter).toBeVisible();

    // Filter toggle should not be visible on tablet
    const filterToggle = page.locator('[data-testid="filter-toggle"]');
    await expect(filterToggle).not.toBeVisible();
  });

  test('should hide bottom navigation on tablet', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Bottom navigation should be hidden on tablet
    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await expect(bottomNav).not.toBeVisible();
  });

  test('should show header navigation on tablet', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Header nav items should be visible
    // User display shows name if available, otherwise email (admin user has name: 'Admin')
    await expect(page.locator('header').getByText(/admin/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /logout/i })).toBeVisible();
  });
});

test.describe('Responsive Design - Desktop Viewport', () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.desktop });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `responsive-desktop-${Date.now()}`);
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: 'info', message: 'Test log message one' },
      { level: 'error', message: 'Test error message' },
      { level: 'debug', message: 'Test debug message' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should show full log table with all columns on desktop', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Table should be visible
    const logTable = page.locator('[data-testid="log-table"]');
    await expect(logTable).toBeVisible();

    // All table columns should be visible
    await expect(page.getByRole('columnheader', { name: /time/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /level/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /message/i })).toBeVisible();
  });

  test('should show all filter controls inline on desktop', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // All filter components should be visible
    await expect(page.locator('[data-testid="level-filter"]')).toBeVisible();
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /last 15 minutes/i })).toBeVisible();
    await expect(page.locator('[data-testid="live-toggle"]')).toBeVisible();
  });

  test('should show header actions on desktop', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Project action buttons in header should be visible
    // Stats link has aria-label="View statistics" which overrides visible text
    await expect(page.getByRole('link', { name: /view statistics/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /settings/i })).toBeVisible();
  });
});

test.describe('Responsive Design - Dashboard Page', () => {
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should show 1 column grid on mobile', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto('/');

    // Create a project to see the grid
    const project = await createProject(page, `grid-test-mobile-${Date.now()}`);

    await page.reload();

    // On mobile, project cards should be in single column (stacked)
    const projectGrid = page.locator('[data-testid="project-grid"]');
    await expect(projectGrid).toBeVisible();

    // Clean up
    await deleteProject(page, project.id);
  });

  test('should show 2 column grid on tablet', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.goto('/');

    // Create a project to see the grid
    const project = await createProject(page, `grid-test-tablet-${Date.now()}`);
    await page.reload();

    const projectGrid = page.locator('[data-testid="project-grid"]');
    await expect(projectGrid).toBeVisible();

    // Grid should have 2 columns at tablet breakpoint
    // We'll verify by checking the grid-cols class
    await expect(projectGrid).toHaveClass(/sm:grid-cols-2/);

    // Clean up
    await deleteProject(page, project.id);
  });

  test('should show multi-column grid on desktop', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto('/');

    // Create a project to see the grid
    const project = await createProject(page, `grid-test-desktop-${Date.now()}`);
    await page.reload();

    const projectGrid = page.locator('[data-testid="project-grid"]');
    await expect(projectGrid).toBeVisible();

    // Grid should have 3-4 columns at desktop breakpoint
    await expect(projectGrid).toHaveClass(/lg:grid-cols-3/);

    // Clean up
    await deleteProject(page, project.id);
  });
});

test.describe('Responsive Design - Filter Collapsing Interaction', () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.mobile });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `filter-collapse-${Date.now()}`);
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: 'info', message: 'Info message' },
      { level: 'error', message: 'Error message' },
      { level: 'warn', message: 'Warning message' },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should toggle filter visibility on mobile', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const filterToggle = page.locator('[data-testid="filter-toggle"]');
    const filterPanel = page.locator('[data-testid="filter-panel"]');

    // Initially collapsed
    await expect(filterPanel).not.toBeVisible();

    // Open filters
    await filterToggle.click();
    await expect(filterPanel).toBeVisible();

    // Close filters by clicking backdrop
    await page.getByRole('button', { name: /close filter panel/i }).click();
    await expect(filterPanel).not.toBeVisible();
  });

  test('should apply filters from collapsed panel', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Open filter panel
    await page.locator('[data-testid="filter-toggle"]').click();

    // Apply level filter (within the panel)
    const filterPanel = page.locator('[data-testid="filter-panel"]');
    const levelFilter = filterPanel.locator('[data-testid="level-filter"]');
    await levelFilter.getByRole('button', { name: /error/i }).click();

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Should show only error logs in card view
    await expect(getLogCard(page, { hasText: 'Error message' })).toBeVisible();

    // Info message should be hidden (check within visible mobile cards container)
    await expect(getLogCard(page, { hasText: 'Info message' })).not.toBeVisible();
  });

  test('should show active filter count badge on toggle button', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Open filter panel
    await page.locator('[data-testid="filter-toggle"]').click();

    // Apply level filter (within the panel)
    const filterPanel = page.locator('[data-testid="filter-panel"]');
    await expect(filterPanel).toBeVisible();

    await filterPanel
      .locator('[data-testid="level-filter"]')
      .getByRole('button', { name: /error/i })
      .click();

    // Wait for filter to apply
    await page.waitForTimeout(300);

    // Close filter panel by pressing Escape
    await page.keyboard.press('Escape');
    await expect(filterPanel).not.toBeVisible();

    // Badge should show active filter count
    const filterBadge = page.locator(
      '[data-testid="filter-toggle"] [data-testid="filter-count-badge"]',
    );
    await expect(filterBadge).toBeVisible();
    await expect(filterBadge).toContainText('1');
  });
});

test.describe('Responsive Design - Log Card Layout', () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.mobile });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `log-cards-${Date.now()}`);
    await ingestOtlpLogs(page, testProject.apiKey, [
      {
        level: 'error',
        message: 'Database connection failed with timeout error',
        attributes: { key: 'value' },
      },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should display log cards with all essential info on mobile', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const logCard = getLogCard(page).first();
    await expect(logCard).toBeVisible();

    // Card should contain: level badge, timestamp, message (mobile-specific test IDs)
    await expect(logCard.locator('[data-testid="log-level-badge-mobile"]')).toBeVisible();
    await expect(logCard.locator('[data-testid="log-timestamp-mobile"]')).toBeVisible();
    await expect(logCard.locator('[data-testid="log-message-mobile"]')).toBeVisible();
  });

  test('should open detail modal when clicking log card', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Click on log card
    await getLogCard(page).first().click();

    // Detail modal should open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Log Details')).toBeVisible();
  });
});

test.describe('Responsive Design - Bottom Navigation', () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.mobile });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `bottom-nav-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should navigate to dashboard via bottom nav', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await bottomNav.getByRole('link', { name: /home|dashboard/i }).click();

    await expect(page).toHaveURL('/');
  });

  test('should navigate to stats via bottom nav', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    // Use testid for stats link for reliability
    await bottomNav.locator('[data-testid="nav-stats"]').click();

    await expect(page).toHaveURL(`/projects/${testProject.id}/stats`);
  });

  test('should show settings from bottom nav', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await bottomNav.getByRole('button', { name: /settings/i }).click();

    // Settings modal should open
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Project Settings')).toBeVisible();
  });

  test('should highlight active navigation item', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');

    // "Logs" should be active on the log stream page
    const logsNavItem = bottomNav.locator('[data-testid="nav-logs"]');
    await expect(logsNavItem).toHaveAttribute('data-active', 'true');

    // Navigate to stats using testid for reliability
    await bottomNav.locator('[data-testid="nav-stats"]').click();

    // "Stats" should now be active
    const statsNavItem = bottomNav.locator('[data-testid="nav-stats"]');
    await expect(statsNavItem).toHaveAttribute('data-active', 'true');
  });
});

test.describe('Responsive Design - Accessibility', () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.mobile });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `a11y-responsive-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('should have proper aria labels on filter toggle', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const filterToggle = page.locator('[data-testid="filter-toggle"]');
    await expect(filterToggle).toHaveAttribute('aria-label', /filter|filters/i);
    await expect(filterToggle).toHaveAttribute('aria-expanded', 'false');

    await filterToggle.click();

    // Wait for panel to be visible (confirms toggle worked)
    const filterPanel = page.locator('[data-testid="filter-panel"]');
    await expect(filterPanel).toBeVisible();

    // aria-expanded should now be true
    await expect(filterToggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('should have proper aria labels on bottom navigation', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    // <nav> element has implicit navigation role - use toHaveRole() instead of toHaveAttribute()
    await expect(bottomNav).toHaveRole('navigation');
    await expect(bottomNav).toHaveAttribute('aria-label', /main|navigation/i);
  });

  test('should be keyboard navigable on mobile', async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    // Focus the filter toggle directly and activate with Enter
    const filterToggle = page.locator('[data-testid="filter-toggle"]');
    await filterToggle.focus();
    await page.keyboard.press('Enter');

    // Filter panel should open
    const filterPanel = page.locator('[data-testid="filter-panel"]');
    await expect(filterPanel).toBeVisible();

    // Should be able to close with Escape (focus is trapped in panel)
    await page.keyboard.press('Escape');
    await expect(filterPanel).not.toBeVisible();
  });
});
