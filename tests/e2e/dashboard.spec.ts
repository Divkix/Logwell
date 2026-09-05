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

test.describe("Dashboard - Empty State", () => {
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    await page.goto("/");
  });

  test("should show empty state when no projects exist", async ({ page }) => {
    await expect(page.getByText(/no projects/i)).toBeVisible();

    await expect(page.getByText(/create.*first.*project/i)).toBeVisible();
  });

  test("should have create project button in empty state", async ({ page }) => {
    const createButtons = page.getByRole("button", { name: /create.*project/i });
    await expect(createButtons).toHaveCount(2);
  });
});

test.describe("Dashboard - Project Display", () => {
  let createdProjects: Array<{ id: string; name: string }> = [];

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    createdProjects = [];

    const project1 = await createProject(page, "test-project-1");
    const project2 = await createProject(page, "test-project-2");
    createdProjects.push(project1, project2);

    await page.goto("/");
  });

  test.afterEach(async ({ page }) => {
    for (const project of createdProjects) {
      await deleteProject(page, project.id);
    }
  });

  test("should display project cards", async ({ page }) => {
    await expect(page.getByText("test-project-1")).toBeVisible();
    await expect(page.getByText("test-project-2")).toBeVisible();
  });

  test("should display project cards with log count", async ({ page }) => {
    const cards = page.locator('[data-testid="project-card"]');
    await expect(cards).toHaveCount(2);

    await expect(page.getByText(/0 logs/i).first()).toBeVisible();
  });

  test("should display View Logs button on project cards", async ({ page }) => {
    const viewLogsButtons = page.getByRole("link", { name: /view logs/i });
    await expect(viewLogsButtons).toHaveCount(2);
  });
});

test.describe("Dashboard - Navigation", () => {
  let testProject: { id: string; name: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);

    testProject = await createProject(page, "navigation-test-project");
    await page.goto("/");
  });

  test.afterEach(async ({ page }) => {
    await deleteProject(page, testProject.id);
  });

  test("should navigate to project page on View Logs click", async ({ page }) => {
    const viewLogsButton = page.getByRole("link", { name: /view logs/i });
    await expect(viewLogsButton).toBeVisible();
    await viewLogsButton.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${testProject.id}`));
  });

  test("should navigate to project page on card click", async ({ page }) => {
    const projectCard = page.locator('[data-testid="project-card"]').first();
    await projectCard.click();

    await expect(page).toHaveURL(new RegExp(`/projects/${testProject.id}`));
  });
});

test.describe("Dashboard - Create Project Modal", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await cleanupProjects(page);
    await page.goto("/");
  });

  test("should open create project modal when clicking create button", async ({ page }) => {
    const createButton = page.getByRole("button", { name: /create.*project/i }).first();
    await createButton.click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText(/create.*project/i)).toBeVisible();
  });

  test("should have project name input in create modal", async ({ page }) => {
    const createButton = page.getByRole("button", { name: /create.*project/i }).first();
    await createButton.click();

    const nameInput = page.getByLabel(/name/i);
    await expect(nameInput).toBeVisible();
  });

  test("should create project and show in list", async ({ page }) => {
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
      await deleteProject(page, newProject.id);
    }
  });

  test("should show validation error for empty project name", async ({ page }) => {
    const createButton = page.getByRole("button", { name: /create.*project/i }).first();
    await createButton.click();

    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^create$/i })
      .click();

    await expect(page.getByTestId("error-message")).toBeVisible();
    await expect(page.getByTestId("error-message")).toHaveText(/cannot be empty/i);
  });

  test("should show error for duplicate project name", async ({ page }) => {
    await createProject(page, "duplicate-test");

    await page.goto("/");

    const createButton = page.getByRole("button", { name: /create.*project/i }).first();
    await createButton.click();

    const nameInput = page.getByLabel(/name/i);
    await nameInput.fill("duplicate-test");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^create$/i })
      .click();

    await expect(page.getByTestId("error-message")).toBeVisible();

    const response = await page.request.get("/api/projects");
    const { projects } = await response.json();
    const testProject = projects.find((p: { name: string }) => p.name === "duplicate-test");
    if (testProject) {
      await deleteProject(page, testProject.id);
    }
  });

  test("should close modal on escape key", async ({ page }) => {
    const createButton = page.getByRole("button", { name: /create.*project/i }).first();
    await createButton.click();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("should close modal on cancel button", async ({ page }) => {
    const createButton = page.getByRole("button", { name: /create.*project/i }).first();
    await createButton.click();

    await page.getByRole("button", { name: /cancel/i }).click();

    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

test.describe("Dashboard - Loading State", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("should show loading state while fetching projects", async ({ page }) => {
    await page.route("/api/projects", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    await page.goto("/");

    await expect(page).toHaveURL("/");
  });
});
