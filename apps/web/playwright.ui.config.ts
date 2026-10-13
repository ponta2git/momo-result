import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:5174";

export default defineConfig({
  testDir: "./e2e/ui",
  outputDir: "test-results-ui",
  fullyParallel: true,
  retries: 0,
  ...(process.env["CI"] ? { workers: 2 } : {}),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-ui-report" }]]
    : "list",
  use: {
    baseURL,
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "ui-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm preview --host 127.0.0.1 --port 5174 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
