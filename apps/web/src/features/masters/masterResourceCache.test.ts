// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  cacheCreatedMaster,
  invalidateMasterResourceCaches,
  invalidateMemberAliasCaches,
} from "@/features/masters/masterResourceCache";
import { createDeferred } from "@/test/deferred";

describe("masterResourceCache", () => {
  it("keeps a confirmed creation when an older list request finishes and retries without duplication", async () => {
    const queryClient = new QueryClient();
    const queryKey = ["masters", "game-titles", "admin-list", "account-1"];
    const existing = { id: "existing", name: "元の作品" };
    const created = { id: "created", name: "追加作品" };
    const original = [existing];
    queryClient.setQueryData(queryKey, original);
    const response = createDeferred<typeof original>();
    const fetching = queryClient
      .fetchQuery({ queryKey, queryFn: () => response.promise })
      .catch(() => undefined);

    await cacheCreatedMaster(queryClient, queryKey, created);
    response.resolve(original);
    await fetching;
    await cacheCreatedMaster(queryClient, queryKey, created);

    expect(queryClient.getQueryData(queryKey)).toEqual([existing, created]);
    expect(original).toEqual([existing]);
  });

  it("does not present a creation as a complete unrequested directory", async () => {
    const queryClient = new QueryClient();
    const queryKey = ["masters", "map-masters", "admin-list", "account-1", "unvisited"];
    await cacheCreatedMaster(queryClient, queryKey, { id: "created" });
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  });

  it.each([
    {
      expectedKeys: [
        ["masters", "game-titles", "admin-list", "account-1"],
        ["masters", "game-titles"],
        ["series-analysis", "options", "v2"],
        ["series-analysis", "status", "v2"],
        ["series-analysis", "admin", "overview"],
      ],
      name: "invalidates game title admin and consumer caches",
      target: { authScope: "account-1", resource: "game-titles" },
    },
    {
      expectedKeys: [
        ["masters", "map-masters", "admin-list", "account-1", "game-1"],
        ["masters", "map-masters"],
        ["series-analysis", "options", "v2"],
        ["series-analysis", "status", "v2"],
        ["series-analysis", "admin", "overview"],
      ],
      name: "invalidates map master admin and consumer caches",
      target: { authScope: "account-1", gameTitleId: "game-1", resource: "map-masters" },
    },
    {
      expectedKeys: [
        ["masters", "season-masters", "admin-list", "account-1", "game-1"],
        ["masters", "season-masters"],
        ["series-analysis", "options", "v2"],
        ["series-analysis", "status", "v2"],
        ["series-analysis", "admin", "overview"],
      ],
      name: "invalidates season master admin and consumer caches",
      target: { authScope: "account-1", gameTitleId: "game-1", resource: "season-masters" },
    },
  ] satisfies Array<{
    expectedKeys: string[][];
    name: string;
    target: Parameters<typeof invalidateMasterResourceCaches>[1];
  }>)("$name", async ({ expectedKeys, target }) => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    await invalidateMasterResourceCaches(queryClient, target);

    expect(invalidateQueries.mock.calls.map(([call]) => call?.queryKey)).toEqual(expectedKeys);
  });

  it("invalidates member alias admin and consumer caches", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    await invalidateMemberAliasCaches(queryClient, "account-1");

    expect(invalidateQueries.mock.calls.map(([call]) => call?.queryKey)).toEqual([
      ["masters", "member-aliases", "admin-list", "account-1"],
      ["masters", "member-aliases"],
    ]);
  });
});
