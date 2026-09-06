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

async function cleanupProjects(page: Page) {
  const response = await page.request.get("/api/projects");
  if (response.ok()) {
    const { projects } = await response.json();
    for (const project of projects) {
      await page.request.delete(`/api/projects/${project.id}`);
    }
  }
}

test.describe("Dashboard - Create Project", () => {
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    await page.goto("/");
  });

  test("creates a project and shows it in the list", async ({ page }) => {
    const createButton = page.getByRole("button", { name: /create.*project/i }).first();
    await createButton.click();

    const nameInput = page.getByLabel(/name/i);
    await nameInput.fill("my-new-project");

    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^create$/i })
      .click();

    await expect(page.getByTestId("api-key-reveal-content")).toBeVisible();
    await expect(page.getByTestId("api-key-reveal-value")).toHaveText(/^lw_[A-Za-z0-9_-]{32}$/);
    await page.getByTestId("api-key-reveal-close").click();
    await expect(page.getByTestId("api-key-reveal-content")).not.toBeVisible();

    await expect(
      page.locator('[data-testid="project-card"]').getByText("my-new-project"),
    ).toBeVisible();

    const response = await page.request.get("/api/projects");
    const { projects } = await response.json();
    const newProject = projects.find((p: { name: string }) => p.name === "my-new-project");
    if (newProject) {
      await page.request.delete(`/api/projects/${newProject.id}`);
    }
  });
});
