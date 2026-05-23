import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:7776',
    trace: 'retain-on-failure',
    extraHTTPHeaders: {
      // bypass the cf-access cookie check; the underlying lib/auth.ts
      // honours `CAIA_AUTH_BYPASS=1`.
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'CAIA_AUTH_BYPASS=1 pnpm dev',
    url: 'http://localhost:7776',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
