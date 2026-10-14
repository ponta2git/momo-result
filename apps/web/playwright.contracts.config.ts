import { defineConfig } from "@playwright/test";

if (!process.env["MOMO_E2E_METADATA"] || !process.env["PLAYWRIGHT_BASE_URL"])
  throw new Error("Use the isolated system contract runner.");

export default defineConfig({
  testDir: "./e2e/contracts",
  outputDir: "test-results-contracts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-contracts-report" }]]
    : "list",
  use: { baseURL: process.env["PLAYWRIGHT_BASE_URL"], trace: "off" },
  projects: [{ name: "service-contracts" }],
});
