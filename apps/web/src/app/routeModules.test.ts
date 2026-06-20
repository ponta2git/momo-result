// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { preloadRouteModule } from "@/app/routeModules";
import { createDeferred } from "@/test/deferred";

describe("preloadRouteModule", () => {
  it("swallows route preload failures because navigation retries through lazy routes", async () => {
    const preloadGate = createDeferred();
    const catchSpy = vi.spyOn(preloadGate.promise, "catch");
    const preload = vi.fn(() => preloadGate.promise);

    preloadRouteModule(preload);
    expect(catchSpy).toHaveBeenCalledTimes(1);
    expect(catchSpy.mock.calls[0]?.[0]?.(new Error("chunk load failed"))).toBeUndefined();

    preloadGate.reject(new Error("chunk load failed"));
    await preloadGate.promise.catch(() => undefined);

    expect(preload).toHaveBeenCalledTimes(1);
  });
});
