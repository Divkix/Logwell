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

  test("loads more logs when clicking load more", async ({ page }) => {
    const logs = [];
    for (let i = 0; i < 150; i++) {
      logs.push({ level: "info" as const, message: `INFO log message ${i}` });
    }
    await ingestOtlpLogs(page, testProject.apiKey, logs);

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
  });
});
