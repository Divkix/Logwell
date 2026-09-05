import { expect, type Page, test } from "@playwright/test";
import { getLogCard } from "./helpers/log-selectors";
import { ingestOtlpLogs } from "./helpers/otlp";

const TEST_USER = {
  username: "admin",
  password: "adminpass",
};

const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
};

async function login(page: Page) {
  await page.goto("/login");
  await page.waitForSelector("form");

  await expect(async () => {
    await page.getByLabel(/username/i).fill(TEST_USER.username);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL("/", { timeout: 10000 });
  }).toPass({ timeout: 45000 });
}

async function createProject(page: Page, name: string) {
  const response = await page.request.post("/api/projects", {
    data: { name },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function deleteProject(page: Page, projectId: string) {
  const response = await page.request.delete(`/api/projects/${projectId}`);
  return response.ok();
}

test.describe("Responsive Design - Mobile Viewport", () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.mobile });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `responsive-mobile-${Date.now()}`);
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "info", message: "Test log message one" },
      { level: "error", message: "Test error message" },
      { level: "warn", message: "Test warning message" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should show collapsible filter toggle on mobile", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const filterToggle = page.locator('[data-testid="filter-toggle"]');
    await expect(filterToggle).toBeVisible();

    const filterPanel = page.locator('[data-testid="filter-panel"]');
    await expect(filterPanel).not.toBeVisible();

    await filterToggle.click();

    await expect(filterPanel).toBeVisible();

    const levelFilterInPanel = filterPanel.locator('[data-testid="level-filter"]');
    await expect(levelFilterInPanel).toBeVisible();
  });

  test("should show log cards instead of table on mobile", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(getLogCard(page).first()).toBeVisible();

    const logTable = page.locator('[data-testid="log-table"] table');
    await expect(logTable).not.toBeVisible();
  });

  test("should show bottom navigation on mobile", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await expect(bottomNav).toBeVisible();

    await expect(bottomNav.getByRole("link", { name: /home|dashboard/i })).toBeVisible();
    await expect(bottomNav.locator('[data-testid="nav-incidents"]')).toBeVisible();
    await expect(bottomNav.locator('[data-testid="nav-stats"]')).toBeVisible();
  });

  test("should hide desktop header navigation on mobile", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const userText = page.locator("header").getByText(/admin/i);
    await expect(userText).not.toBeVisible();

    const logoutText = page.locator("header").getByText("Logout");
    await expect(logoutText).not.toBeVisible();
  });

  test("should stack project header elements on mobile", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(page.getByRole("heading", { name: testProject.name })).toBeVisible();

    const headerButtons = page.locator('[data-testid="project-header-actions"]');

    await expect(headerButtons).not.toBeVisible();
  });

  test("should have full-width search input on mobile", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await page.locator('[data-testid="filter-toggle"]').click();

    const filterPanel = page.locator('[data-testid="filter-panel"]');
    await expect(filterPanel).toBeVisible();

    const searchContainer = filterPanel.locator('[data-testid="search-container"]');
    const searchBoundingBox = await searchContainer.boundingBox();

    expect(searchBoundingBox?.width).toBeGreaterThan(VIEWPORTS.mobile.width - 64);
  });
});

test.describe("Responsive Design - Tablet Viewport", () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.tablet });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `responsive-tablet-${Date.now()}`);
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "info", message: "Test log message one" },
      { level: "error", message: "Test error message" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should show log table on tablet", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const logTable = page.locator('[data-testid="log-table"] table');
    await expect(logTable).toBeVisible();

    await expect(getLogCard(page).first()).not.toBeVisible();
  });

  test("should show inline filters on tablet", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const levelFilter = page.locator('[data-testid="level-filter"]');
    await expect(levelFilter).toBeVisible();

    const filterToggle = page.locator('[data-testid="filter-toggle"]');
    await expect(filterToggle).not.toBeVisible();
  });

  test("should hide bottom navigation on tablet", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await expect(bottomNav).not.toBeVisible();
  });

  test("should show header navigation on tablet", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(page.locator("header").getByText(/admin/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /logout/i })).toBeVisible();
  });
});

test.describe("Responsive Design - Desktop Viewport", () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.desktop });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `responsive-desktop-${Date.now()}`);
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "info", message: "Test log message one" },
      { level: "error", message: "Test error message" },
      { level: "debug", message: "Test debug message" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should show full log table with all columns on desktop", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const logTable = page.locator('[data-testid="log-table"]');
    await expect(logTable).toBeVisible();

    await expect(page.getByRole("columnheader", { name: /time/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /level/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /message/i })).toBeVisible();
  });

  test("should show all filter controls inline on desktop", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(page.locator('[data-testid="level-filter"]')).toBeVisible();
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /last 15 minutes/i })).toBeVisible();
    await expect(page.locator('[data-testid="live-toggle"]')).toBeVisible();
  });

  test("should show header actions on desktop", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(page.getByRole("link", { name: /view statistics/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /settings/i })).toBeVisible();
  });
});

test.describe("Responsive Design - Dashboard Page", () => {
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("should show 1 column grid on mobile", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/");

    const project = await createProject(page, `grid-test-mobile-${Date.now()}`);

    await page.reload();

    const projectGrid = page.locator('[data-testid="project-grid"]');
    await expect(projectGrid).toBeVisible();

    await deleteProject(page, project.id);
  });

  test("should show 2 column grid on tablet", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.tablet);
    await page.goto("/");

    const project = await createProject(page, `grid-test-tablet-${Date.now()}`);
    await page.reload();

    const projectGrid = page.locator('[data-testid="project-grid"]');
    await expect(projectGrid).toBeVisible();

    await expect(projectGrid).toHaveClass(/sm:grid-cols-2/);

    await deleteProject(page, project.id);
  });

  test("should show multi-column grid on desktop", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/");

    const project = await createProject(page, `grid-test-desktop-${Date.now()}`);
    await page.reload();

    const projectGrid = page.locator('[data-testid="project-grid"]');
    await expect(projectGrid).toBeVisible();

    await expect(projectGrid).toHaveClass(/lg:grid-cols-3/);

    await deleteProject(page, project.id);
  });
});

test.describe("Responsive Design - Filter Collapsing Interaction", () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.mobile });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `filter-collapse-${Date.now()}`);
    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "info", message: "Info message" },
      { level: "error", message: "Error message" },
      { level: "warn", message: "Warning message" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should toggle filter visibility on mobile", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const filterToggle = page.locator('[data-testid="filter-toggle"]');
    const filterPanel = page.locator('[data-testid="filter-panel"]');

    await expect(filterPanel).not.toBeVisible();

    await filterToggle.click();
    await expect(filterPanel).toBeVisible();

    await page.getByRole("button", { name: /close filter panel/i }).click();
    await expect(filterPanel).not.toBeVisible();
  });

  test("should apply filters from collapsed panel", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await page.locator('[data-testid="filter-toggle"]').click();

    const filterPanel = page.locator('[data-testid="filter-panel"]');
    const levelFilter = filterPanel.locator('[data-testid="level-filter"]');
    await levelFilter.getByRole("button", { name: /error/i }).click();

    await page.waitForTimeout(500);

    await expect(getLogCard(page, { hasText: "Error message" })).toBeVisible();

    await expect(getLogCard(page, { hasText: "Info message" })).not.toBeVisible();
  });

  test("should show active filter count badge on toggle button", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await page.locator('[data-testid="filter-toggle"]').click();

    const filterPanel = page.locator('[data-testid="filter-panel"]');
    await expect(filterPanel).toBeVisible();

    await filterPanel
      .locator('[data-testid="level-filter"]')
      .getByRole("button", { name: /error/i })
      .click();

    await page.waitForTimeout(300);

    await page.keyboard.press("Escape");
    await expect(filterPanel).not.toBeVisible();

    const filterBadge = page.locator(
      '[data-testid="filter-toggle"] [data-testid="filter-count-badge"]',
    );
    await expect(filterBadge).toBeVisible();
    await expect(filterBadge).toContainText("1");
  });
});

test.describe("Responsive Design - Log Card Layout", () => {
  test.describe.configure({ retries: 1 });
  test.use({ viewport: VIEWPORTS.mobile });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `log-cards-${Date.now()}`);
    await ingestOtlpLogs(page, testProject.apiKey, [
      {
        level: "error",
        message: "Database connection failed with timeout error",
        attributes: { key: "value" },
      },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should display log cards with all essential info on mobile", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const logCard = getLogCard(page).first();
    await expect(logCard).toBeVisible();

    await expect(logCard.locator('[data-testid="log-level-badge-mobile"]')).toBeVisible();
    await expect(logCard.locator('[data-testid="log-timestamp-mobile"]')).toBeVisible();
    await expect(logCard.locator('[data-testid="log-message-mobile"]')).toBeVisible();
  });

  test("should open detail modal when clicking log card", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await getLogCard(page).first().click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Log Details")).toBeVisible();
  });
});

test.describe("Responsive Design - Bottom Navigation", () => {
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

  test("should navigate to dashboard via bottom nav", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await bottomNav.getByRole("link", { name: /home|dashboard/i }).click();

    await expect(page).toHaveURL("/");
  });

  test("should navigate to stats via bottom nav", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await bottomNav.locator('[data-testid="nav-stats"]').click();

    await expect(page).toHaveURL(`/projects/${testProject.id}/stats`);
  });

  test("should navigate to incidents via bottom nav", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await bottomNav.locator('[data-testid="nav-incidents"]').click();

    await expect(page).toHaveURL(`/projects/${testProject.id}/incidents`);
  });

  test("should navigate to settings from bottom nav", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await bottomNav.locator('[data-testid="nav-settings"]').click();

    await expect(page).toHaveURL(`/projects/${testProject.id}/settings`);
  });

  test("should highlight active navigation item", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');

    const logsNavItem = bottomNav.locator('[data-testid="nav-logs"]');
    await expect(logsNavItem).toHaveAttribute("data-active", "true");

    await bottomNav.locator('[data-testid="nav-stats"]').click();

    const statsNavItem = bottomNav.locator('[data-testid="nav-stats"]');
    await expect(statsNavItem).toHaveAttribute("data-active", "true");
  });
});

test.describe("Responsive Design - Accessibility", () => {
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

  test("should have proper aria labels on filter toggle", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const filterToggle = page.locator('[data-testid="filter-toggle"]');
    await expect(filterToggle).toHaveAttribute("aria-label", /filter|filters/i);
    await expect(filterToggle).toHaveAttribute("aria-expanded", "false");

    await filterToggle.click();

    const filterPanel = page.locator('[data-testid="filter-panel"]');
    await expect(filterPanel).toBeVisible();

    await expect(filterToggle).toHaveAttribute("aria-expanded", "true");
  });

  test("should have proper aria labels on bottom navigation", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const bottomNav = page.locator('[data-testid="bottom-nav"]');
    await expect(bottomNav).toHaveRole("navigation");
    await expect(bottomNav).toHaveAttribute("aria-label", /main|navigation/i);
  });

  test("should be keyboard navigable on mobile", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const filterToggle = page.locator('[data-testid="filter-toggle"]');
    await filterToggle.focus();
    await page.keyboard.press("Enter");

    const filterPanel = page.locator('[data-testid="filter-panel"]');
    await expect(filterPanel).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(filterPanel).not.toBeVisible();
  });
});
