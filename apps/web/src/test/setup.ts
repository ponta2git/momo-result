import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";

import { resetMswStores } from "@/shared/api/msw/handlers";
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
  resetMswStores();
  window.localStorage.clear();
});
afterAll(() => server.close());
