const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  // Security and state-transition failures must fail the run, without retries hiding them.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start -- --hostname localhost --port 3000',
    url: 'http://localhost:3000',
    timeout: 120_000,
    reuseExistingServer: false,
    env: { NODE_ENV: 'production' }
  }
});
