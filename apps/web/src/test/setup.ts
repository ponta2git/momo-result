import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

const hasDom = typeof window !== "undefined";

if (hasDom) {
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => "blob:test";
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = () => undefined;
  }
}

afterEach(() => {
  if (hasDom) {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});
