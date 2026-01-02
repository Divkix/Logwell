import type { PlaywrightTestConfig } from '@playwright/test';

// Use preview mode in CI for stability (avoids Vite dev server HMR issues)
const isCI = !!process.env.CI;
const port = isCI ? 4173 : 5173;

const config: PlaywrightTestConfig = {
  testDir: './tests/e2e',
  testMatch: /(.+\.)?(test|spec)\.[jt]s/,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
  ],
  webServer: {
    command: isCI ? 'bun run build && bun run preview' : 'bun run dev',
    url: `http://localhost:${port}`,
    reuseExistingServer: !isCI,
    timeout: 180000,
    stdout: 'pipe',
  },
};

export default config;
