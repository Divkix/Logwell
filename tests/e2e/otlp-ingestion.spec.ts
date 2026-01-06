import { expect, type Page, test } from '@playwright/test';
import { getLogMessage } from './helpers/log-selectors';

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
  const response = await page.request.post('/api/projects', {
    data: { name },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function deleteProject(page: Page, projectId: string) {
  const response = await page.request.delete(`/api/projects/${projectId}`);
  return response.ok();
}

async function ingestOtlpLog(page: Page, apiKey: string, message: string) {
  const payload = {
    resourceLogs: [
      {
        scopeLogs: [
          {
            logRecords: [
              {
                severityNumber: 9,
                severityText: 'INFO',
                body: { stringValue: message },
              },
            ],
          },
        ],
      },
    ],
  };

  const response = await page.request.post('/v1/logs', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    data: payload,
  });

  expect(response.ok()).toBeTruthy();
}

test.describe('OTLP Ingestion', () => {
  let testProject: { id: string; name: string; apiKey: string };

  test.beforeEach(async ({ page }) => {
    await login(page);
    testProject = await createProject(page, `otlp-test-${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    if (testProject?.id) {
      await deleteProject(page, testProject.id);
    }
  });

  test('ingests OTLP logs and renders them in the UI', async ({ page }) => {
    const message = 'OTLP log arrives';
    await ingestOtlpLog(page, testProject.apiKey, message);

    await page.goto(`/projects/${testProject.id}`);
    await expect(getLogMessage(page, message)).toBeVisible();
  });
});
