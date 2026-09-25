// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  cacheCreatedMaster,
  cacheMasterUpdate,
  invalidateMasterResourceCaches,
  invalidateMemberAliasCaches,
} from "@/features/masters/masterResourceCache";
import { heldEventKeys, masterKeys, matchKeys, seriesAnalysisKeys } from "@/shared/api/queryKeys";
import { createDeferred } from "@/test/deferred";
import { createTestQueryClient } from "@/test/queryClient";

describe("masterResourceCache", () => {
  it("keeps one raw response shared by readers after an older request finishes", async () => {
    const queryClient = createTestQueryClient();
    const queryKey = masterKeys.gameTitles.list();
    const existing = { id: "existing", name: "元の作品" };
    const created = { id: "created", name: "追加作品" };
    const original = { items: [existing] };
    queryClient.setQueryData(queryKey, original);
    const response = createDeferred<typeof original>();
    const fetching = queryClient
      .fetchQuery({ queryKey, queryFn: () => response.promise })
      .catch(() => undefined);

    await cacheCreatedMaster(queryClient, queryKey, created);
    response.resolve(original);
    await fetching;

    expect(queryClient.getQueryData(queryKey)).toEqual({ items: [existing, created] });
    expect(original).toEqual({ items: [existing] });

    await cacheCreatedMaster(queryClient, queryKey, created);
    expect(queryClient.getQueryData(queryKey)).toEqual({ items: [existing, created] });
  });

  it("keeps committed edits and deletions in every loaded scope without inventing new rows", async () => {
    const queryClient = createTestQueryClient();
    const original = { id: "map-1", name: "旧名" };
    queryClient.setQueryData(masterKeys.mapMasters.list(), { items: [original] });
    queryClient.setQueryData(masterKeys.mapMasters.list("title-1"), { items: [original] });
    queryClient.setQueryData(masterKeys.mapMasters.list("other-title"), { items: [] });
    const updated = { ...original, name: "訂正後" };
    await cacheMasterUpdate(queryClient, masterKeys.mapMasters.all(), original.id, updated);
    expect(queryClient.getQueryData(masterKeys.mapMasters.list())).toEqual({ items: [updated] });
    expect(queryClient.getQueryData(masterKeys.mapMasters.list("title-1"))).toEqual({
      items: [updated],
    });
    expect(queryClient.getQueryData(masterKeys.mapMasters.list("other-title"))).toEqual({
      items: [],
    });
    await cacheMasterUpdate(queryClient, masterKeys.mapMasters.all(), original.id, null);
    expect(queryClient.getQueryData(masterKeys.mapMasters.list())).toEqual({ items: [] });
    expect(queryClient.getQueryData(masterKeys.mapMasters.list("title-1"))).toEqual({ items: [] });
  });

  it("does not present a creation as a complete unrequested directory", async () => {
    const queryClient = createTestQueryClient();
    const queryKey = masterKeys.mapMasters.list("unvisited");
    await cacheCreatedMaster(queryClient, queryKey, { id: "created" });
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
  });

  it.each([
    { resource: "game-titles", directoryKey: masterKeys.gameTitles.list() },
    { resource: "map-masters", directoryKey: masterKeys.mapMasters.list("title-1") },
    { resource: "season-masters", directoryKey: masterKeys.seasonMasters.list("title-1") },
  ] as const)(
    "refreshes $resource labels in lists, details, and analysis as well as the shared directory",
    async ({ resource, directoryKey }) => {
      const queryClient = createTestQueryClient();
      const affected = [
        directoryKey,
        matchKeys.list({}),
        matchKeys.detail("match-1"),
        heldEventKeys.detail("held-1"),
        seriesAnalysisKeys.options(),
        seriesAnalysisKeys.status("title-1"),
        seriesAnalysisKeys.adminOverview("title-1"),
        seriesAnalysisKeys.aggregate({ artifactId: "artifact-1" }),
      ];
      for (const key of affected) queryClient.setQueryData(key, {});
      queryClient.setQueryData(masterKeys.memberAliases.list(), { items: [] });

      await invalidateMasterResourceCaches(queryClient, resource);

      for (const key of affected) {
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
      }
      expect(queryClient.getQueryState(masterKeys.memberAliases.list())?.isInvalidated).toBe(false);
    },
  );

  it("invalidates only the shared alias directory when aliases change", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(masterKeys.memberAliases.list(), { items: [] });
    queryClient.setQueryData(masterKeys.gameTitles.list(), { items: [] });
    await invalidateMemberAliasCaches(queryClient);
    expect(queryClient.getQueryState(masterKeys.memberAliases.list())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(masterKeys.gameTitles.list())?.isInvalidated).toBe(false);
  });
});
