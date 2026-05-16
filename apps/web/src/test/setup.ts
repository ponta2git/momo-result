import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

import { closeToast } from "@/shared/ui/feedback/Toast";

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
  closeToast();
  if (hasDom) {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});
