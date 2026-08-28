import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

const apiProxyTarget = process.env["VITE_API_PROXY_TARGET"] ?? "http://localhost:8080";
const backendProxy = {
  "/api": apiProxyTarget,
  "/healthz": apiProxyTarget,
} as const;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: backendProxy,
  },
  preview: {
    proxy: backendProxy,
  },
  test: {
    coverage: {
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.tsx",
        "src/shared/api/generated.ts",
        "src/test/**",
      ],
      include: ["src/app/**/*.ts", "src/features/**/*.ts", "src/shared/**/*.ts"],
      reporter: ["text", "lcov", "json-summary"],
    },
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**", "scripts/**/*.test.mjs"],
    globals: true,
    pool: "threads",
    setupFiles: ["./src/test/setup.ts"],
  },
});
