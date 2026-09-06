import { expect, type Page, test } from "@playwright/test";
import { getLogMessage } from "./helpers/log-selectors";
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

async function ingestLog(
  page: Page,
  apiKey: string,
  log: { level: "debug" | "info" | "warn" | "error" | "fatal"; message: string },
) {
  await ingestOtlpLogs(page, apiKey, [{ level: log.level, message: log.message }]);
}

test.describe("Log Stream Page", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `log-stream-test-${Date.now()}`);

    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "info", message: "Application started successfully" },
      { level: "error", message: "Failed to connect to database" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("ingested logs render in the log table", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(page.locator('[data-testid="log-table"]')).toBeVisible();

    await expect(getLogMessage(page, "Application started successfully")).toBeVisible();
    await expect(getLogMessage(page, "Failed to connect to database")).toBeVisible();
  });

  test("receives new logs while live streaming", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(page.locator('[data-testid="log-table"]')).toBeVisible();

    await ingestLog(page, testProject.apiKey, {
      level: "info",
      message: "New log from live stream test",
    });

    await expect(getLogMessage(page, "New log from live stream test")).toBeVisible({
      timeout: 5000,
    });
  });

  test("stops receiving logs when live is paused", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const liveSwitch = page.getByRole("switch", { name: /toggle live streaming/i });
    await liveSwitch.click();

    const livePulse = page.locator('[data-testid="live-pulse"]');
    await expect(livePulse).not.toHaveClass(/bg-green-500/);

    await ingestLog(page, testProject.apiKey, {
      level: "error",
      message: "Log after live disabled",
    });

    await page.waitForTimeout(2000);

    await expect(getLogMessage(page, "Log after live disabled")).not.toBeVisible();
  });

  test("pauses live with notice while searching", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const livePulse = page.locator('[data-testid="live-pulse"]');
    await expect(livePulse).toHaveClass(/bg-green-500/);

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.click();
    await searchInput.type("test", { delay: 50 });

    await page.waitForTimeout(500);
    await page.waitForURL(/search=test/, { timeout: 5000 });

    const liveSwitch = page.getByRole("switch", { name: /toggle live streaming/i });
    await expect(liveSwitch).toBeDisabled();

    const pauseNotice = page.getByTestId("live-paused-notice");
    await expect(pauseNotice).toBeVisible();
    await expect(pauseNotice).toContainText(/paused|search/i);

    await searchInput.clear();

    await page.waitForTimeout(500);
    await page.waitForURL(/projects\/[^/]+$/, { timeout: 5000 });

    await expect(liveSwitch).toBeEnabled();
    await expect(pauseNotice).not.toBeVisible();
  });
});
