import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { resetMswStores } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

const hasDom = typeof window !== "undefined";

if (hasDom) {
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => "blob:test";
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = () => undefined;
  }
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetMswStores();
  if (hasDom) {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => server.close());
