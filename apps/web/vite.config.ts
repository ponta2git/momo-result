import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const backendProxy = {
  "/api": "http://localhost:8080",
  "/healthz": "http://localhost:8080",
  "/openapi.yaml": "http://localhost:8080",
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
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        "src/features/masters/masterResourceCache.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/features/matches/workspace/scoreGrid/ScoreGridKeyboard.ts": {
          branches: 95,
          functions: 100,
          lines: 95,
          statements: 95,
        },
        "src/shared/api/queryErrorState.ts": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        branches: 70,
        functions: 77,
        lines: 78,
        statements: 78,
      },
    },
    environment: "jsdom",
    fileParallelism: true,
    globals: true,
    isolate: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
