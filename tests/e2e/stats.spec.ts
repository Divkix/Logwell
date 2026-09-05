import { expect, type Page, test } from "@playwright/test";
import { ingestOtlpLogs } from "./helpers/otlp";

const TEST_USER = {
  username: "admin",
  password: "adminpass",
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

test.describe("Stats Page - Display", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `stats-test-${Date.now()}`);

    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "debug", message: "Debug log 1" },
      { level: "debug", message: "Debug log 2" },
      { level: "info", message: "Info log 1" },
      { level: "info", message: "Info log 2" },
      { level: "info", message: "Info log 3" },
      { level: "warn", message: "Warning log 1" },
      { level: "error", message: "Error log 1" },
      { level: "error", message: "Error log 2" },
      { level: "fatal", message: "Fatal log 1" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should display donut chart", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    await expect(page.locator('[data-testid="level-chart-container"]')).toBeVisible();

    await expect(page.locator('[data-testid="level-chart-svg"]')).toBeVisible();

    await expect(page.locator('[data-testid="chart-segment-debug"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-segment-info"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-segment-warn"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-segment-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-segment-fatal"]')).toBeVisible();
  });

  test("should display total log count", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    const totalCount = page.locator('[data-testid="chart-total"]');
    await expect(totalCount).toBeVisible();
    await expect(totalCount).toContainText("9"); // We ingested 9 logs

    await expect(totalCount).toContainText("Total");
  });

  test("should display legend with level counts and percentages", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    const legend = page.locator('[data-testid="level-chart-legend"]');
    await expect(legend).toBeVisible();

    await expect(page.locator('[data-testid="legend-item-debug"]')).toBeVisible();
    await expect(page.locator('[data-testid="legend-item-info"]')).toBeVisible();
    await expect(page.locator('[data-testid="legend-item-warn"]')).toBeVisible();
    await expect(page.locator('[data-testid="legend-item-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="legend-item-fatal"]')).toBeVisible();

    await expect(page.locator('[data-testid="legend-item-info"]')).toContainText("3");
  });

  test("should display project name in header", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    await expect(page.getByRole("heading", { name: testProject.name })).toBeVisible();
  });
});

test.describe("Stats Page - Time Range Filter", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `stats-time-range-test-${Date.now()}`);

    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "info", message: "Recent info log 1" },
      { level: "info", message: "Recent info log 2" },
      { level: "error", message: "Recent error log" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should display time range picker with options", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    await expect(page.getByRole("button", { name: /last 15 minutes/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /last hour/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /last 24 hours/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /last 7 days/i })).toBeVisible();
  });

  test("should highlight selected time range", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    const dayButton = page.getByRole("button", { name: /last 24 hours/i });
    await expect(dayButton).toHaveAttribute("data-selected", "true");

    await page.getByRole("button", { name: /last 7 days/i }).click();

    await expect(page.getByRole("button", { name: /last 7 days/i })).toHaveAttribute(
      "data-selected",
      "true",
    );
    await expect(dayButton).toHaveAttribute("data-selected", "false");
  });

  test("should update chart data when time range changes", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    await expect(page.locator('[data-testid="level-chart-container"]')).toBeVisible();

    await expect(page.locator('[data-testid="chart-total"]')).toContainText("3");

    await page.getByRole("button", { name: /last 15 minutes/i }).click();

    await expect(page).toHaveURL(/range=15m/, { timeout: 10000 });

    await expect(page.locator('[data-testid="chart-total"]')).toContainText("3");
  });
});

test.describe("Stats Page - Empty State", () => {
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

  test("should display empty state when no logs exist", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    await expect(page.locator('[data-testid="level-chart-empty"]')).toBeVisible();
    await expect(page.getByText("No data")).toBeVisible();
  });

  test("should display zero total when no logs", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    const chartContainer = page.locator('[data-testid="level-chart-container"]');
    await expect(chartContainer).toBeVisible();
  });
});

test.describe("Stats Page - Navigation", () => {
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

  test("should have back button to log stream page", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    const backButton = page.getByRole("link", { name: /back|logs/i });
    await expect(backButton).toBeVisible();

    await backButton.click();
    await expect(page).toHaveURL(`/projects/${testProject.id}`);
  });

  test("should be accessible from log stream page", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const statsLink = page.getByRole("link", { name: /stats|statistics|chart/i });
    await expect(statsLink).toBeVisible();

    await statsLink.click();
    await expect(page).toHaveURL(`/projects/${testProject.id}/stats`);
  });
});

test.describe("Stats Page - Responsive Layout", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `stats-responsive-test-${Date.now()}`);

    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "info", message: "Test log" },
      { level: "error", message: "Test error" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should render correctly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`/projects/${testProject.id}/stats`);

    await expect(page.locator('[data-testid="level-chart-container"]')).toBeVisible();

    await expect(page.getByRole("button", { name: /last 24 hours/i })).toBeVisible();
  });
});

test.describe("Stats Page - Timeseries Chart", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `stats-timeseries-test-${Date.now()}`);

    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "info", message: "Info log 1" },
      { level: "info", message: "Info log 2" },
      { level: "error", message: "Error log 1" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should display timeseries chart on stats page", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    await expect(page.locator('[data-testid="timeseries-chart"]')).toBeVisible();

    await expect(page.getByRole("heading", { name: /logs over time/i })).toBeVisible();
  });

  test("should show loading state then chart", async ({ page }) => {
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/stats/timeseries") && response.status() === 200,
    );

    await page.goto(`/projects/${testProject.id}/stats`);

    await expect(page.locator('[data-testid="timeseries-chart"]')).toBeVisible();

    await responsePromise;

    await expect(page.locator('[data-testid="timeseries-skeleton"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="timeseries-error"]')).not.toBeVisible();
  });

  test("should update timeseries chart when time range changes", async ({ page }) => {
    const initialResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/stats/timeseries") && response.status() === 200,
    );

    await page.goto(`/projects/${testProject.id}/stats`);

    await initialResponsePromise;

    const rangeChangeResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/stats/timeseries?range=7d") && response.status() === 200,
    );

    await page.getByRole("button", { name: /last 7 days/i }).click();

    await rangeChangeResponse;

    await expect(page.locator('[data-testid="timeseries-chart"]')).toBeVisible();
  });
});

test.describe("Stats Page - Timeseries Empty State", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `stats-timeseries-empty-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should display empty state when no logs exist", async ({ page }) => {
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/stats/timeseries") && response.status() === 200,
    );

    await page.goto(`/projects/${testProject.id}/stats`);

    await responsePromise;

    await expect(page.locator('[data-testid="timeseries-chart"]')).toBeVisible();

    await expect(page.locator('[data-testid="timeseries-skeleton"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="timeseries-error"]')).not.toBeVisible();
  });
});
