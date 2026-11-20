import { defineConfig, devices } from "@playwright/test";

import system from "./playwright.system.config";

export default defineConfig({
  // Both projects use the same per-screen outcome and release files in the controlled Worker.
  ...system,
  testDir: "./e2e/recovery",
  outputDir: "test-results-recovery",
  projects: [
    { name: "recovery-chromium", testDir: "./e2e/recovery", use: { ...devices["Desktop Chrome"] } },
    { name: "service-contracts", testDir: "./e2e/contracts" },
  ],
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-recovery-report" }]]
    : "list",
});
