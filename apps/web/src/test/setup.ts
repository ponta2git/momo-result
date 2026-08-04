import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

const hasDom = typeof window !== "undefined";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

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
  if (hasDom) {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  }
  if (hasDom && !window.localStorage) {
    vi.stubGlobal("localStorage", createMemoryStorage());
  }
  if (hasDom && !window.sessionStorage) {
    vi.stubGlobal("sessionStorage", createMemoryStorage());
  }
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
