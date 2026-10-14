import { defineConfig, devices } from "@playwright/test";

if (!process.env["MOMO_E2E_METADATA"] || !process.env["PLAYWRIGHT_BASE_URL"])
  throw new Error("Use the isolated system E2E runner.");

export default defineConfig({
  testDir: "./e2e/system",
  outputDir: "test-results-system",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-system-report" }]]
    : "list",
  use: {
    baseURL: process.env["PLAYWRIGHT_BASE_URL"],
    screenshot: "only-on-failure",
    // Session cookies and CSRF responses must not enter uploaded browser traces.
    trace: "off",
  },
  projects: [{ name: "system-chromium", use: { ...devices["Desktop Chrome"] } }],
});
