import { defineConfig, devices } from "@playwright/test";

import system from "./playwright.system.config";

export default defineConfig(system, {
  testDir: "./e2e/recovery",
  outputDir: "test-results-recovery",
  projects: [{ name: "recovery-chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-recovery-report" }]]
    : "list",
});
