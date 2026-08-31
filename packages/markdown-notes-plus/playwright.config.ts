import { defineConfig, devices } from "@playwright/test";

const isProd = Boolean(process.env.E2E_PROD);
const isMobileProtocol = Boolean(process.env.E2E_MOBILE_PROTOCOL);
const port = Number(process.env.E2E_PORT ?? 5173);

export default defineConfig({
  testDir: "./tests/e2e/specs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--disable-web-security",
            "--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults,PrivateNetworkAccessSendPreflights",
          ],
        },
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: {
    command: isProd
      ? `vite preview --host 127.0.0.1 --port ${port} --strictPort`
      : `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/test-host.html`,
    reuseExistingServer: !process.env.CI && !isMobileProtocol,
    timeout: 30000,
  },
});
