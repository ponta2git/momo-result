import { defineConfig, devices } from "@playwright/test";

if (!process.env["MOM24_E2E_METADATA"])
  throw new Error("Use the isolated OCR notification runner.");
export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results-ocr",
  testMatch: "ocr-submission-notifications.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report-ocr" }]]
    : "list",
  use: {
    actionTimeout: 15_000,
    baseURL: process.env["PLAYWRIGHT_BASE_URL"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
