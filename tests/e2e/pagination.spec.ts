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

async function sendOTLPLogs(
  page: Page,
  apiKey: string,
  count: number,
  level: "debug" | "info" | "warn" | "error" | "fatal" = "info",
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

test.describe("Cursor-based Pagination", () => {
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

  test("shows load more button when more logs exist", async ({ page }) => {
    await sendOTLPLogs(page, testProject.apiKey, 150, "info");

    await page.goto(`/projects/${testProject.id}`);

    await page.waitForSelector('[data-testid="log-table"]', { timeout: 10000 });

    await expect(page.locator("text=more available")).toBeVisible();

    const loadMoreButton = page.locator('[data-testid="load-more-button"]');
    await expect(loadMoreButton).toBeVisible();
    await expect(loadMoreButton).toHaveText("Load More");
  });

  test("hides load more button when all logs are loaded", async ({ page }) => {
    await sendOTLPLogs(page, testProject.apiKey, 50, "info");

    await page.goto(`/projects/${testProject.id}`);
    await page.waitForSelector('[data-testid="log-table"]', { timeout: 10000 });

    const loadMoreButton = page.locator('[data-testid="load-more-button"]');
    await expect(loadMoreButton).not.toBeVisible();

    await expect(page.locator("text=more available")).not.toBeVisible();
  });

  test("loads more logs when clicking load more button", async ({ page }) => {
    await sendOTLPLogs(page, testProject.apiKey, 150, "info");

    await page.goto(`/projects/${testProject.id}`);
    await page.waitForSelector('[data-testid="log-table"]', { timeout: 10000 });

    const initialRows = await page.locator('[data-testid="log-row"]').count();
    expect(initialRows).toBeLessThanOrEqual(100);

    const loadMoreButton = page.locator('[data-testid="load-more-button"]');
    await expect(loadMoreButton).toBeVisible();

    await loadMoreButton.click();

    await expect(loadMoreButton).toContainText("Loading...");

    await page.waitForTimeout(2000);

    const newRowCount = await page.locator('[data-testid="log-row"]').count();
    expect(newRowCount).toBeGreaterThan(initialRows);

    const buttonVisible = await loadMoreButton.isVisible();
    if (buttonVisible) {
      await expect(loadMoreButton).toContainText("Load More");
    }
  });
});
