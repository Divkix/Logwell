import { expect, type Page, test } from "@playwright/test";
import { getLevelBadge, getLogMessage } from "./helpers/log-selectors";
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

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

async function ingestLog(
  page: Page,
  apiKey: string,
  log: {
    level: LogLevel;
    message: string;
    metadata?: Record<string, unknown>;
    source_file?: string;
    line_number?: number;
    request_id?: string;
    user_id?: string;
    ip_address?: string;
  },
) {
  const attributes: Record<string, unknown> = { ...log.metadata };

  if (log.source_file) attributes["code.filepath"] = log.source_file;
  if (log.line_number !== undefined) attributes["code.lineno"] = log.line_number;
  if (log.request_id) attributes["request.id"] = log.request_id;
  if (log.user_id) attributes["enduser.id"] = log.user_id;
  if (log.ip_address) attributes["client.address"] = log.ip_address;

  await ingestOtlpLogs(page, apiKey, [{ level: log.level, message: log.message, attributes }]);
}

test.describe("Log Stream Page - Display", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `log-stream-test-${Date.now()}`);

    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "info", message: "Application started successfully" },
      { level: "warn", message: "Deprecated API usage detected" },
      { level: "error", message: "Failed to connect to database" },
      { level: "debug", message: "Processing request payload" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should display log table with entries", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(page.locator('[data-testid="log-table"]')).toBeVisible();

    await expect(getLogMessage(page, "Application started successfully")).toBeVisible();
    await expect(getLogMessage(page, "Deprecated API usage detected")).toBeVisible();
    await expect(getLogMessage(page, "Failed to connect to database")).toBeVisible();
    await expect(getLogMessage(page, "Processing request payload")).toBeVisible();
  });

  test("should display project name in header", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(page.getByRole("heading", { name: testProject.name })).toBeVisible();
  });

  test("should display level badges for each log", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(getLevelBadge(page, "INFO")).toBeVisible();
    await expect(getLevelBadge(page, "WARN")).toBeVisible();
    await expect(getLevelBadge(page, "ERROR")).toBeVisible();
    await expect(getLevelBadge(page, "DEBUG")).toBeVisible();
  });
});

test.describe("Log Stream Page - Live Toggle", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `live-toggle-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should show live toggle in enabled state by default", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const liveToggle = page.locator('[data-testid="live-pulse"]');
    await expect(liveToggle).toBeVisible();

    await expect(liveToggle).toHaveClass(/bg-green-500/);
  });

  test("should receive new logs when live streaming is enabled", async ({ page }) => {
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

  test("should stop receiving logs when live toggle is disabled", async ({ page }) => {
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
});

test.describe("Log Stream Page - Search Filter", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `search-test-${Date.now()}`);

    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "info", message: "User authentication successful" },
      { level: "info", message: "Payment processing completed" },
      { level: "error", message: "Database connection failed" },
      { level: "warn", message: "Memory usage high" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should filter logs by search term", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(getLogMessage(page, "User authentication successful")).toBeVisible();

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill("database");

    await page.waitForTimeout(500);

    await expect(getLogMessage(page, "Database connection failed")).toBeVisible();

    await expect(getLogMessage(page, "User authentication successful")).not.toBeVisible();
    await expect(getLogMessage(page, "Payment processing completed")).not.toBeVisible();
  });

  test("should show all logs when search is cleared", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill("payment");
    await page.waitForTimeout(500);

    await searchInput.fill("");
    await page.waitForTimeout(500);

    await expect(getLogMessage(page, "User authentication successful")).toBeVisible();
    await expect(getLogMessage(page, "Payment processing completed")).toBeVisible();
    await expect(getLogMessage(page, "Database connection failed")).toBeVisible();
  });
});

test.describe("Log Stream Page - Level Filter", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `level-filter-test-${Date.now()}`);

    await ingestOtlpLogs(page, testProject.apiKey, [
      { level: "debug", message: "Debug message one" },
      { level: "info", message: "Info message one" },
      { level: "warn", message: "Warning message one" },
      { level: "error", message: "Error message one" },
      { level: "fatal", message: "Fatal message one" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should filter logs by level", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(getLogMessage(page, "Error message one")).toBeVisible();

    const levelFilter = page.locator('[data-testid="level-filter"]');
    await levelFilter.getByRole("button", { name: /error/i }).click();

    await page.waitForTimeout(500);

    await expect(getLogMessage(page, "Error message one")).toBeVisible();

    await expect(getLogMessage(page, "Debug message one")).not.toBeVisible();
    await expect(getLogMessage(page, "Info message one")).not.toBeVisible();
    await expect(getLogMessage(page, "Warning message one")).not.toBeVisible();
  });

  test("should support multiple level selection", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(getLogMessage(page, "Error message one")).toBeVisible();

    const levelFilter = page.locator('[data-testid="level-filter"]');

    await levelFilter.getByRole("button", { name: /error/i }).click();
    await page.waitForTimeout(300);

    await levelFilter.getByRole("button", { name: /fatal/i }).click();
    await page.waitForTimeout(500);

    await expect(getLogMessage(page, "Error message one")).toBeVisible();
    await expect(getLogMessage(page, "Fatal message one")).toBeVisible();

    await expect(getLogMessage(page, "Debug message one")).not.toBeVisible();
    await expect(getLogMessage(page, "Info message one")).not.toBeVisible();
  });
});

test.describe("Log Stream Page - Time Range Filter", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `time-range-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should display time range picker with options", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(page.getByRole("button", { name: /last 15 minutes/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /last hour/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /last 24 hours/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /last 7 days/i })).toBeVisible();
  });

  test("should highlight selected time range", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const hourButton = page.getByRole("button", { name: /last hour/i });
    await expect(hourButton).toHaveAttribute("data-selected", "true");

    await page.getByRole("button", { name: /last 24 hours/i }).click();

    await expect(page.getByRole("button", { name: /last 24 hours/i })).toHaveAttribute(
      "data-selected",
      "true",
    );
    await expect(hourButton).toHaveAttribute("data-selected", "false");
  });

  test("should filter logs by time range", async ({ page }) => {
    await ingestLog(page, testProject.apiKey, {
      level: "info",
      message: "Recent log message",
    });

    await page.goto(`/projects/${testProject.id}`);

    await page.getByRole("button", { name: /last 15 minutes/i }).click();
    await expect(getLogMessage(page, "Recent log message")).toBeVisible();
  });
});

test.describe("Log Stream Page - Log Detail Modal", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `detail-modal-test-${Date.now()}`);

    await ingestLog(page, testProject.apiKey, {
      level: "error",
      message: "Detailed error for testing",
      metadata: { key: "value", nested: { foo: "bar" } },
      source_file: "src/test.ts",
      line_number: 42,
      request_id: "req_abc123",
      user_id: "user_456",
      ip_address: "192.168.1.100",
    });
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should open detail modal when clicking log row", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(getLogMessage(page, "Detailed error for testing")).toBeVisible();

    await getLogMessage(page, "Detailed error for testing").click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Log Details")).toBeVisible();
  });

  test("should display all log fields in detail modal", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const logMessage = getLogMessage(page, "Detailed error for testing");
    await expect(logMessage).toBeVisible();
    await logMessage.click();

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible({ timeout: 10000 });

    await expect(modal.getByText("Detailed error for testing")).toBeVisible();
    await expect(modal.getByText("src/test.ts:42")).toBeVisible();
    await expect(modal.getByText("req_abc123").first()).toBeVisible();
    await expect(modal.getByText("user_456").first()).toBeVisible();
    await expect(modal.getByText("192.168.1.100").first()).toBeVisible();

    await expect(page.locator('[data-testid="log-metadata"]')).toContainText('"key": "value"');
  });

  test("should close modal on Escape key", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await getLogMessage(page, "Detailed error for testing").click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("should close modal on overlay click", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await getLogMessage(page, "Detailed error for testing").click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.locator('[data-testid="modal-overlay"]').click({ position: { x: 10, y: 10 } });

    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

test.describe("Log Stream Page - Settings Navigation", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `settings-nav-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should navigate to settings page when clicking settings link", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const settingsLink = page.getByRole("link", { name: /settings/i });
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();

    await expect(page).toHaveURL(`/projects/${testProject.id}/settings`);
  });

  test("should not display the API key on the settings page until regenerated", async ({
    page,
  }) => {
    await page.goto(`/projects/${testProject.id}`);

    await page.getByRole("link", { name: /settings/i }).click();
    await expect(page).toHaveURL(`/projects/${testProject.id}/settings`);

    await expect(page.getByTestId("api-key-display")).toHaveCount(0);
    await expect(page.getByTestId("regenerate-button")).toBeVisible();
  });

  test("should show curl example on settings page", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await page.getByRole("link", { name: /settings/i }).click();
    await expect(page).toHaveURL(`/projects/${testProject.id}/settings`);

    await expect(page.locator('[data-testid="example-code"]')).toContainText("curl");
    await expect(page.locator('[data-testid="example-code"]')).toContainText("Authorization");
  });
});

test.describe("Log Stream Page - Empty State", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `empty-state-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should show empty state when no logs exist", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(page.locator('[data-testid="log-table"]')).toBeVisible();
    await expect(page.getByRole("cell", { name: "No logs yet" })).toBeVisible();
  });
});

test.describe("Log Stream Page - Navigation", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `navigation-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should have back button to dashboard", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const backButton = page.getByRole("link", { name: /back|dashboard|home/i });
    await expect(backButton).toBeVisible();

    await backButton.click();
    await expect(page).toHaveURL("/");
  });
});
