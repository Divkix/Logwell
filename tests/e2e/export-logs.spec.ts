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

async function ingestLogsBatch(
  page: Page,
  apiKey: string,
  logs: Array<{ level: "debug" | "info" | "warn" | "error" | "fatal"; message: string }>,
) {
  await ingestOtlpLogs(page, apiKey, logs);
}

test.describe("Log Export", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-filter-test-${Date.now()}`);

    await ingestLogsBatch(page, testProject.apiKey, [
      { level: "info", message: "Info message about database" },
      { level: "error", message: "Error connecting to database" },
      { level: "warn", message: "Warning about memory usage" },
      { level: "error", message: "Critical error occurred" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("exports only the level-filtered logs", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const levelFilter = page.locator('[data-testid="level-filter"]');
    await levelFilter.getByRole("button", { name: /error/i }).click();
    await page.waitForTimeout(500); // Wait for filter to apply

    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-csv"]').click();

    const download = await downloadPromise;
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (readStream) {
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const csvContent = Buffer.concat(chunks).toString("utf-8");

    expect(csvContent).toContain("Error connecting to database");
    expect(csvContent).toContain("Critical error occurred");
    expect(csvContent).not.toContain("Info message about database");
    expect(csvContent).not.toContain("Warning about memory usage");
  });
});
