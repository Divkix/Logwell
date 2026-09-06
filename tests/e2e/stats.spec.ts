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

test.describe("Stats Page", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `stats-test-${Date.now()}`);

    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "debug", message: "Debug log 1" },
      { level: "info", message: "Info log 1" },
      { level: "info", message: "Info log 2" },
      { level: "warn", message: "Warning log 1" },
      { level: "error", message: "Error log 1" },
      { level: "fatal", message: "Fatal log 1" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("renders the level chart for ingested logs", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}/stats`);

    await expect(page.locator('[data-testid="level-chart-container"]')).toBeVisible();
    await expect(page.locator('[data-testid="level-chart-svg"]')).toBeVisible();

    await expect(page.locator('[data-testid="chart-segment-info"]')).toBeVisible();
    await expect(page.locator('[data-testid="chart-segment-error"]')).toBeVisible();

    const totalCount = page.locator('[data-testid="chart-total"]');
    await expect(totalCount).toBeVisible();
    await expect(totalCount).toContainText("6");
  });
});
