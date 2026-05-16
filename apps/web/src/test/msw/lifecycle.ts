import { afterAll, afterEach, beforeAll } from "vitest";

import { resetMswStores } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";

export function setupMsw(): void {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => {
    server.resetHandlers();
    resetMswStores();
  });
  afterAll(() => server.close());
}
