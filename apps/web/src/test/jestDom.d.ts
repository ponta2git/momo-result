import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import "vitest";

// jest-dom 7.0.1's /vitest entry point still augments the pre-Vitest-5 Assertion type.
// Use Vitest's return-type-aware interface until the upstream integration supports it.
declare module "vitest" {
  interface Matchers<R, T> extends TestingLibraryMatchers<unknown, R> {}
}
