import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://127.0.0.1:5173";
const skipWebServer = process.env["PLAYWRIGHT_SKIP_WEB_SERVER"] === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  use: {
    acceptDownloads: true,
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: "pnpm dev --host 0.0.0.0 --port 5173 --strictPort",
        reuseExistingServer: !process.env["CI"],
        timeout: 120_000,
        url: baseURL,
      },
});
