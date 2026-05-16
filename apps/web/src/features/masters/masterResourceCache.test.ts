// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  invalidateMasterResourceCaches,
  invalidateMemberAliasCaches,
} from "@/features/masters/masterResourceCache";

describe("masterResourceCache", () => {
  it.each([
    {
      expectedKeys: [
        ["masters", "game-titles", "admin-list", "account-1"],
        ["masters", "game-titles"],
      ],
      name: "invalidates game title admin and consumer caches",
      target: { authScope: "account-1", resource: "game-titles" },
    },
    {
      expectedKeys: [
        ["masters", "map-masters", "admin-list", "account-1", "game-1"],
        ["masters", "map-masters"],
      ],
      name: "invalidates map master admin and consumer caches",
      target: { authScope: "account-1", gameTitleId: "game-1", resource: "map-masters" },
    },
    {
      expectedKeys: [
        ["masters", "season-masters", "admin-list", "account-1", "game-1"],
        ["masters", "season-masters"],
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
