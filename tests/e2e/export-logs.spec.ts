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
  logs: Array<{
    level: "debug" | "info" | "warn" | "error" | "fatal";
    message: string;
    metadata?: Record<string, unknown>;
    sourceFile?: string;
    lineNumber?: number;
    requestId?: string;
    userId?: string;
    ipAddress?: string;
  }>,
) {
  const otlpLogs = logs.map((log) => {
    const attributes: Record<string, unknown> = { ...log.metadata };

    if (log.sourceFile) attributes["code.filepath"] = log.sourceFile;
    if (log.lineNumber !== undefined) attributes["code.lineno"] = log.lineNumber;
    if (log.requestId) attributes["request.id"] = log.requestId;
    if (log.userId) attributes["enduser.id"] = log.userId;
    if (log.ipAddress) attributes["client.address"] = log.ipAddress;

    return { level: log.level, message: log.message, attributes };
  });

  await ingestOtlpLogs(page, apiKey, otlpLogs);
}

function parseCsv(csvContent: string): string[][] {
  const lines = csvContent.trim().split("\n");
  return lines.map((line) => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields;
  });
}

test.describe("Log Export - Visibility", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-visibility-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should show export button when logs exist", async ({ page }) => {
    await ingestLogsBatch(page, testProject.apiKey, [
      { level: "info", message: "Test log for export visibility" },
      { level: "error", message: "Another test log" },
    ]);

    await page.goto(`/projects/${testProject.id}`);

    const exportButton = page.locator('[data-testid="export-button"]');
    await expect(exportButton).toBeVisible({ timeout: 5000 });
  });

  test("should hide export button when no logs exist", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await expect(page.locator('[data-testid="log-table"]')).toBeVisible();
    await expect(page.getByRole("cell", { name: "No logs yet" })).toBeVisible();

    const exportButton = page.locator('[data-testid="export-button"]');
    await expect(exportButton).not.toBeVisible();
  });
});

test.describe("Log Export - Format Selection", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-format-test-${Date.now()}`);

    await ingestLogsBatch(page, testProject.apiKey, [
      { level: "info", message: "Format selection test log" },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should show format dropdown when clicking export button", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const exportButton = page.locator('[data-testid="export-button"]');
    await expect(exportButton).toBeVisible();
    await exportButton.click();

    await expect(page.locator('[data-testid="export-csv"]')).toBeVisible();
    await expect(page.locator('[data-testid="export-json"]')).toBeVisible();
  });

  test("should close dropdown when pressing Escape", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const exportButton = page.locator('[data-testid="export-button"]');
    await exportButton.click();
    await expect(page.locator('[data-testid="export-csv"]')).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.locator('[data-testid="export-csv"]')).not.toBeVisible();
  });
});

test.describe("Log Export - CSV Download", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-csv-test-${Date.now()}`);

    await ingestLogsBatch(page, testProject.apiKey, [
      {
        level: "info",
        message: "CSV export test log",
        metadata: { key: "value" },
        sourceFile: "test.ts",
        lineNumber: 42,
        requestId: "req_123",
        userId: "user_456",
        ipAddress: "192.168.1.1",
      },
      {
        level: "error",
        message: "Error log for CSV",
      },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should trigger CSV download with correct filename pattern", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await page.locator('[data-testid="export-button"]').click();

    const downloadPromise = page.waitForEvent("download");

    await page.locator('[data-testid="export-csv"]').click();

    const download = await downloadPromise;
    const filename = download.suggestedFilename();

    expect(filename).toMatch(/^logs-.+\.csv$/);
    expect(filename).toContain(testProject.name.replace(/[^a-zA-Z0-9-_]/g, "-"));
  });

  test("should download CSV with expected headers", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

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

    const rows = parseCsv(csvContent);
    const headers = rows[0];

    expect(headers).toContain("id");
    expect(headers).toContain("level");
    expect(headers).toContain("message");
    expect(headers).toContain("timestamp");
    expect(headers).toContain("sourceFile");
    expect(headers).toContain("lineNumber");
    expect(headers).toContain("requestId");
    expect(headers).toContain("userId");
    expect(headers).toContain("ipAddress");
    expect(headers).toContain("metadata");
  });

  test("should download CSV with correct data rows", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

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

    expect(csvContent).toContain("CSV export test log");
    expect(csvContent).toContain("Error log for CSV");
    expect(csvContent).toContain("info");
    expect(csvContent).toContain("error");
  });
});

test.describe("Log Export - JSON Download", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-json-test-${Date.now()}`);

    await ingestLogsBatch(page, testProject.apiKey, [
      {
        level: "warn",
        message: "JSON export test log",
        metadata: { environment: "test" },
      },
      {
        level: "debug",
        message: "Debug log for JSON",
      },
    ]);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should trigger JSON download with correct filename pattern", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await page.locator('[data-testid="export-button"]').click();

    const downloadPromise = page.waitForEvent("download");

    await page.locator('[data-testid="export-json"]').click();

    const download = await downloadPromise;
    const filename = download.suggestedFilename();

    expect(filename).toMatch(/^logs-.+\.json$/);
    expect(filename).toContain(testProject.name.replace(/[^a-zA-Z0-9-_]/g, "-"));
  });

  test("should download valid JSON array", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-json"]').click();

    const download = await downloadPromise;
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (readStream) {
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const jsonContent = Buffer.concat(chunks).toString("utf-8");

    let parsedJson: unknown;
    expect(() => {
      parsedJson = JSON.parse(jsonContent);
    }).not.toThrow();

    expect(Array.isArray(parsedJson)).toBe(true);
  });

  test("should download JSON with expected fields", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-json"]').click();

    const download = await downloadPromise;
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (readStream) {
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const jsonContent = Buffer.concat(chunks).toString("utf-8");

    const logs = JSON.parse(jsonContent) as Array<Record<string, unknown>>;

    expect(logs.length).toBeGreaterThan(0);
    const firstLog = logs[0];

    expect(firstLog).toHaveProperty("id");
    expect(firstLog).toHaveProperty("level");
    expect(firstLog).toHaveProperty("message");
    expect(firstLog).toHaveProperty("timestamp");

    const messages = logs.map((l) => l.message);
    expect(messages).toContain("JSON export test log");
    expect(messages).toContain("Debug log for JSON");
  });
});

test.describe("Log Export - With Filters", () => {
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

  test("should export filtered logs when level filter is active", async ({ page }) => {
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

  test("should export filtered logs when search filter is active", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill("database");
    await page.waitForTimeout(500); // Wait for debounce

    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-json"]').click();

    const download = await downloadPromise;
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (readStream) {
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
    }
    const jsonContent = Buffer.concat(chunks).toString("utf-8");

    const logs = JSON.parse(jsonContent) as Array<Record<string, unknown>>;
    const messages = logs.map((l) => l.message as string);

    expect(messages.every((msg) => msg.toLowerCase().includes("database"))).toBe(true);
    expect(messages).toContain("Info message about database");
    expect(messages).toContain("Error connecting to database");
  });

  test("should export filtered logs with combined filters", async ({ page }) => {
    await page.goto(`/projects/${testProject.id}`);

    const levelFilter = page.locator('[data-testid="level-filter"]');
    await levelFilter.getByRole("button", { name: /error/i }).click();
    await page.waitForTimeout(300);

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill("database");
    await page.waitForTimeout(500);

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
    expect(csvContent).not.toContain("Info message about database"); // Wrong level
    expect(csvContent).not.toContain("Critical error occurred"); // Missing search term
    expect(csvContent).not.toContain("Warning about memory usage"); // Wrong level and missing search
  });
});

test.describe("Log Export - Edge Cases", () => {
  test.describe.configure({ retries: 1 });

  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `export-edge-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should handle export of logs with special characters in message", async ({ page }) => {
    await ingestLogsBatch(page, testProject.apiKey, [
      {
        level: "info",
        message: 'Log with special chars: "quotes", commas,, and\nnewlines',
      },
    ]);

    await page.goto(`/projects/${testProject.id}`);

    await page.locator('[data-testid="export-button"]').click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="export-csv"]').click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test("should handle export when filter results in no logs", async ({ page }) => {
    await ingestLogsBatch(page, testProject.apiKey, [{ level: "info", message: "Single log" }]);

    await page.goto(`/projects/${testProject.id}`);

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill("nonexistentterm123456");
    await page.waitForTimeout(500);

    const exportButton = page.locator('[data-testid="export-button"]');
    const isVisible = await exportButton.isVisible();

    if (isVisible) {
      await exportButton.click();
      const downloadPromise = page.waitForEvent("download");
      await page.locator('[data-testid="export-json"]').click();

      const download = await downloadPromise;
      const readStream = await download.createReadStream();
      const chunks: Buffer[] = [];
      if (readStream) {
        for await (const chunk of readStream) {
          chunks.push(Buffer.from(chunk));
        }
      }
      const jsonContent = Buffer.concat(chunks).toString("utf-8");
      const logs = JSON.parse(jsonContent) as Array<Record<string, unknown>>;

      expect(logs.length).toBe(0);
    } else {
      expect(isVisible).toBe(false);
    }
  });
});
