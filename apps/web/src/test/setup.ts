import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

const hasDom = typeof window !== "undefined";

if (hasDom) {
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => "blob:test";
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = () => undefined;
  }
}

let unexpectedConsoleMessages: string[] = [];

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg)))
    .join(" ");
}

beforeEach(() => {
  unexpectedConsoleMessages = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    unexpectedConsoleMessages.push(`console.error: ${formatConsoleArgs(args)}`);
  });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    unexpectedConsoleMessages.push(`console.warn: ${formatConsoleArgs(args)}`);
  });
});

afterEach(() => {
  const consoleMessages = unexpectedConsoleMessages;
  if (hasDom) {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (consoleMessages.length > 0) {
    throw new Error(`Unexpected console output during test:\n${consoleMessages.join("\n")}`);
  }
});
