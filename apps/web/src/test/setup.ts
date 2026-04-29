import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "@/shared/api/msw/server";

if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:test";
}

if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => undefined;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  window.localStorage.clear();
});
afterAll(() => server.close());
