import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  evictDeletedMatchDetail,
  invalidateAfterMatchNoteReplaced,
} from "@/shared/api/cacheInvalidation";
import { commitMatchNoteCache } from "@/shared/api/matchNoteCache";
import { matchKeys } from "@/shared/api/queryKeys";
import { matchDetailQueryOptions, matchRouteDetailQueryOptions } from "@/shared/api/queryOptions";
import { setDevUser } from "@/test/auth";
import { makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();
beforeEach(() => setDevUser());

describe("detail read cache", () => {
  it("updates both aliases of a record without confusing a numeric legacy ID with a public number", async () => {
    const client = createTestQueryClient();
    const target = makeMatchDetail({
      matchId: "target",
      publicId: "1",
      note: { body: "before", version: "a" },
    });
    const collision = makeMatchDetail({
      matchId: "1",
      publicId: "2",
      note: { body: "other record", version: "b" },
    });
    server.use(
      http.get("/api/public/matches/1", () => HttpResponse.json(target)),
      http.get("/api/matches/target", () => HttpResponse.json(target)),
      http.get("/api/matches/1", () => HttpResponse.json(collision)),
    );
    const byPublic = matchRouteDetailQueryOptions(undefined, "1");
    const byLegacy = matchDetailQueryOptions("target");
    const other = matchDetailQueryOptions("1");
    await Promise.all([
      client.fetchQuery(byPublic),
      client.fetchQuery(byLegacy),
      client.fetchQuery(other),
    ]);
    await commitMatchNoteCache(client, {
      matchId: "target",
      body: "saved",
      expectedVersion: "a",
      version: "c",
    });
    for (const key of [byPublic.queryKey, byLegacy.queryKey]) {
      const result = client.getQueryData(key);
      expect(result?.kind === "found" && result.detail.note).toEqual({
        body: "saved",
        version: "c",
      });
    }
    const otherData = client.getQueryData(other.queryKey);
    expect(otherData?.kind === "found" && otherData.detail.note).toEqual(collision.note);
    await invalidateAfterMatchNoteReplaced(client, "target");
    expect(client.getQueryState(byPublic.queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(byLegacy.queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other.queryKey)?.isInvalidated).toBe(false);
    evictDeletedMatchDetail(client, "target");
    expect(client.getQueryData(byPublic.queryKey)).toBeUndefined();
    expect(client.getQueryData(byLegacy.queryKey)).toBeUndefined();
    expect(client.getQueryData(other.queryKey)).toEqual(otherData);
  });

  it("keeps confirmed absence after a later transport failure, until a new successful read", async () => {
    const client = createTestQueryClient();
    const options = matchDetailQueryOptions("match-1");
    expect((await client.fetchQuery(options)).kind).toBe("found");
    server.use(
      http.get("/api/matches/:matchId", () =>
        HttpResponse.json(
          {
            type: "about:blank",
            title: "Not Found",
            detail: "Missing",
            status: 404,
            code: "NOT_FOUND",
          },
          { status: 404 },
        ),
      ),
    );
    await client.invalidateQueries({ queryKey: options.queryKey });
    expect((await client.fetchQuery(options)).kind).toBe("notFound");
    server.use(http.get("/api/matches/:matchId", () => new HttpResponse(null, { status: 500 })));
    await client.invalidateQueries({ queryKey: options.queryKey });
    await expect(client.fetchQuery(options)).rejects.toBeDefined();
    expect(client.getQueryData(options.queryKey)?.kind).toBe("notFound");
    server.use(http.get("/api/matches/:matchId", () => HttpResponse.json(makeMatchDetail())));
    expect((await client.fetchQuery(options)).kind).toBe("found");
  });

  it.each([undefined, { next: { matchId: "match-1" } }, { previous: false }])(
    "retains the body when added navigation is missing or malformed (%j)",
    async (navigation) => {
      const client = createTestQueryClient();
      server.use(
        http.get("/api/matches/:matchId", () =>
          HttpResponse.json({ ...makeMatchDetail(), navigation }),
        ),
      );
      const result = await client.fetchQuery(matchDetailQueryOptions("match-1"));
      expect(result.kind).toBe("found");
      if (result.kind !== "found") throw new Error("Expected detail body");
      expect(result.detail.matchId).toBe("match-1");
      expect(result.navigation.kind).toBe("unavailable");
    },
  );

  it("acknowledges the saved note without attributing the old author or replacing another version", async () => {
    const client = createTestQueryClient();
    const options = matchDetailQueryOptions("match-1");
    server.use(
      http.get("/api/matches/:matchId", () =>
        HttpResponse.json(
          makeMatchDetail({
            note: {
              body: "以前",
              version: "opaque-a",
              updatedByDisplayName: "以前の更新者",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          }),
        ),
      ),
    );
    await client.fetchQuery(options);
    await commitMatchNoteCache(client, {
      matchId: "match-1",
      expectedVersion: "opaque-a",
      version: "opaque-b",
      body: "保存済み",
    });
    const saved = client.getQueryData(options.queryKey);
    expect(saved?.kind === "found" && saved.detail.note).toEqual({
      body: "保存済み",
      version: "opaque-b",
    });
    await commitMatchNoteCache(client, {
      matchId: "match-1",
      expectedVersion: "opaque-a",
      version: "opaque-old",
      body: "遅れた応答",
    });
    expect(client.getQueryData(options.queryKey)).toEqual(saved);
    const missing = {
      kind: "notFound" as const,
      error: {
        kind: "api" as const,
        status: 404,
        code: "NOT_FOUND",
        title: "Missing",
        detail: "Missing",
      },
    };
    client.setQueryData(matchKeys.detail("match-1"), missing);
    await commitMatchNoteCache(client, {
      matchId: "match-1",
      expectedVersion: "opaque-b",
      version: "opaque-c",
      body: "削除後",
    });
    expect(client.getQueryData(options.queryKey)).toEqual(missing);
  });
});
