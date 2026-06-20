// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { preloadRouteModule } from "@/app/routeModules";

describe("preloadRouteModule", () => {
  it("swallows route preload failures because navigation retries through lazy routes", async () => {
    const preload = vi.fn().mockRejectedValue(new Error("chunk load failed"));

    preloadRouteModule(preload);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(preload).toHaveBeenCalledTimes(1);
  });
});
