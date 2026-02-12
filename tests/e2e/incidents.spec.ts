import { expect, type Page, test } from '@playwright/test';
import { ingestOtlpLogs } from './helpers/otlp';

const TEST_USER = {
  username: 'admin',
  password: 'adminpass',
};

async function login(page: Page) {
  await page.goto('/login');
  await page.waitForSelector('form');

  await page.getByLabel(/username/i).fill(TEST_USER.username);
  await page.getByLabel(/password/i).fill(TEST_USER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL('/', { timeout: 15000 });
}

async function createProject(page: Page, name: string) {
  const response = await page.request.post('/api/projects', { data: { name } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function deleteProject(page: Page, projectId: string) {
  await page.request.delete(`/api/projects/${projectId}`);
}

test.describe('Incidents Page', () => {
  test.describe.configure({ retries: 1 });

  let project: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    project = await createProject(page, `incident-e2e-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (project?.id) {
      await deleteProject(page, project.id);
    }
  });

  test('groups similar errors into a single incident and opens timeline panel', async ({
    page,
  }) => {
    await ingestOtlpLogs(page, project.apiKey, [
      {
        level: 'error',
        message: 'Database timeout after 1000ms for user 123',
        attributes: { 'service.name': 'api', 'code.filepath': 'src/db.ts', 'code.lineno': 42 },
      },
      {
        level: 'error',
        message: 'Database timeout after 2500ms for user 999',
        attributes: { 'service.name': 'api', 'code.filepath': 'src/db.ts', 'code.lineno': 42 },
      },
    ]);

    await page.goto(`/projects/${project.id}/incidents`);
    await expect(page.locator('[data-testid="incident-table"]')).toBeVisible();
    const visibleIncidentItems = page.locator(
      '[data-testid="incident-row"]:visible, [data-testid="incident-card"]:visible',
    );
    await expect(visibleIncidentItems).toHaveCount(1);

    const rowOrCard = visibleIncidentItems.first();
    await rowOrCard.click();

    const timelinePanel = page.locator('[data-testid="incident-timeline-panel"]');
    await expect(timelinePanel).toBeVisible();
    await expect(
      timelinePanel.getByRole('heading', { name: 'Root-Cause Candidates', exact: true }),
    ).toBeVisible();
  });

  test('updates incident list in real-time when new error arrives', async ({ page }) => {
    await page.goto(`/projects/${project.id}/incidents`);
    await expect(page.locator('[data-testid="incident-table"]')).toBeVisible();

    await ingestOtlpLogs(page, project.apiKey, [
      {
        level: 'error',
        message: 'Payment gateway unavailable for order 555',
        attributes: {
          'service.name': 'billing',
          'code.filepath': 'src/payment.ts',
          'code.lineno': 88,
        },
      },
    ]);

    await expect(
      page.getByText(/payment gateway unavailable/i).filter({ visible: true }),
    ).toBeVisible({ timeout: 10000 });
  });
});
