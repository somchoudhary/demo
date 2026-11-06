import { defineConfig } from '@playwright/test'
import chromium from '@sparticuz/chromium'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      // Sparticuz defaults to Lambda's single-process mode. Playwright creates a
      // fresh context per test, so use Chromium's normal multi-process mode here.
      args: chromium.args.filter((arg) => arg !== '--single-process' && arg !== '--disable-web-security'),
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
