import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { commitMatchNoteCache } from "@/shared/api/matchNoteCache";
import { matchKeys } from "@/shared/api/queryKeys";
import { matchDetailQueryOptions } from "@/shared/api/queryOptions";
import { setDevUser } from "@/test/auth";
import { makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();
beforeEach(() => setDevUser());

describe("detail read cache", () => {
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
