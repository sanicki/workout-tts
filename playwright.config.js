// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8802',
    viewport: { width: 400, height: 800 },
    trace: 'retain-on-failure',
    // Use the browser preinstalled by the sandbox rather than triggering a
    // download; CI (no PLAYWRIGHT_BROWSERS_PATH override) installs its own
    // and ignores this.
    launchOptions: process.env.PLAYWRIGHT_BROWSERS_PATH
      ? { executablePath: `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` }
      : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'python3 -m http.server 8802',
    url: 'http://localhost:8802/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
