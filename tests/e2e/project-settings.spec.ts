import { expect, type Page, test } from "@playwright/test";

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

async function cleanupProjects(page: Page) {
  const response = await page.request.get("/api/projects");
  if (response.ok()) {
    const { projects } = await response.json();
    for (const project of projects) {
      await deleteProject(page, project.id);
    }
  }
}

test.describe("Project Settings", () => {
  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    testProject = await createProject(page, "settings-test-project");
    await page.goto(`/projects/${testProject.id}/settings`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test("renames the project", async ({ page }) => {
    await page.getByTestId("edit-name-button").click();

    const input = page.getByTestId("project-name-input");
    await expect(input).toBeVisible();

    await input.clear();
    await input.fill("renamed-project");

    await page.getByTestId("save-name-button").click();

    await expect(page.getByTestId("project-name-display")).toHaveText("renamed-project");

    testProject.name = "renamed-project";
  });

  test("changes the retention window", async ({ page }) => {
    await page.getByTestId("retention-selector").click();

    await page.getByTestId("retention-option-30").click();

    await page.waitForTimeout(500);

    await expect(page.getByTestId("retention-selector")).toContainText("30 days");
  });

  test("reveals a new API key after regenerating", async ({ page }) => {
    await page.getByTestId("regenerate-button").click();
    await page.getByTestId("confirm-regenerate-button").click();

    const apiKeyDisplay = page.getByTestId("api-key-display");
    await expect(apiKeyDisplay).toBeVisible();
    await expect(apiKeyDisplay).toContainText(/^lw_[A-Za-z0-9_-]{32}$/);

    await expect(apiKeyDisplay).not.toContainText(testProject.apiKey);
    await expect(page.getByTestId("api-key-once-warning")).toBeVisible();
  });
});
