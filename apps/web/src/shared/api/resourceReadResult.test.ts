import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import {
  invalidateAfterMatchConfirmed,
  invalidateAfterMatchUpdated,
} from "@/shared/api/cacheInvalidation";
import { syncHeldEventCreatedCache } from "@/shared/api/heldEventCache";
import type { ProblemDetails } from "@/shared/api/problemDetails";
import { heldEventKeys, matchKeys } from "@/shared/api/queryKeys";
import {
  heldEventSummaryReadQueryOptions,
  matchIdentityQueryOptions,
  matchIdentityReadQueryOptions,
} from "@/shared/api/queryOptions";
import { loadResourceReadResult } from "@/shared/api/resourceReadResult";
import { setDevUser } from "@/test/auth";
import { makeHeldEventResponse, makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();
beforeEach(() => setDevUser());

const missing = {
  type: "about:blank",
  title: "Not Found",
  status: 404,
  detail: "The selected resource does not exist.",
  code: "NOT_FOUND",
} satisfies ProblemDetails;

describe("resource read cache", () => {
  it("keeps raw and read-result identities separate and refetches both after editing", async () => {
    const client = createTestQueryClient();
    const before = makeMatchDetail({ matchId: "match-1", matchNoInEvent: 1 });
    const after = makeMatchDetail({ matchId: "match-1", matchNoInEvent: 2 });
    let response = before;
    server.use(http.get("/api/matches/match-1/identity", () => HttpResponse.json(response)));
    const raw = { ...matchIdentityQueryOptions("match-1"), staleTime: Number.POSITIVE_INFINITY };
    const read = {
      ...matchIdentityReadQueryOptions("match-1"),
      staleTime: Number.POSITIVE_INFINITY,
    };
    expect(await client.fetchQuery(raw)).toEqual(before);
    expect(await client.fetchQuery(read)).toEqual({ kind: "found", value: before });
    expect(client.getQueryData(raw.queryKey)).toEqual(before);

    response = after;
    await invalidateAfterMatchUpdated(client, "match-1");

    expect(await client.fetchQuery(read)).toEqual({ kind: "found", value: after });
    expect(await client.fetchQuery(raw)).toEqual(after);
  });

  it("revalidates an absent identity after a match is confirmed", async () => {
    const client = createTestQueryClient();
    const options = {
      ...matchIdentityReadQueryOptions("match-1"),
      staleTime: Number.POSITIVE_INFINITY,
    };
    server.use(
      http.get("/api/matches/match-1/identity", () => HttpResponse.json(missing, { status: 404 })),
    );
    expect(await client.fetchQuery(options)).toEqual({ kind: "notFound" });
    const match = makeMatchDetail({ matchId: "match-1" });
    server.use(http.get("/api/matches/match-1/identity", () => HttpResponse.json(match)));

    await invalidateAfterMatchConfirmed(client);

    expect(await client.fetchQuery(options)).toEqual({ kind: "found", value: match });
    expect(client.getQueryData(matchKeys.identity("match-1"))).toBeUndefined();
  });

  it("revalidates an absent summary after creation without changing the seeded raw response shape", async () => {
    const client = createTestQueryClient();
    const options = {
      ...heldEventSummaryReadQueryOptions("held-new"),
      staleTime: Number.POSITIVE_INFINITY,
    };
    server.use(
      http.get("/api/held-events/held-new/summary", () =>
        HttpResponse.json(missing, { status: 404 }),
      ),
    );
    expect(await client.fetchQuery(options)).toEqual({ kind: "notFound" });
    const event = makeHeldEventResponse({ id: "held-new" });
    server.use(http.get("/api/held-events/held-new/summary", () => HttpResponse.json(event)));

    await syncHeldEventCreatedCache(client, event);

    expect(client.getQueryData(heldEventKeys.summary(event.id))).toEqual(event);
    expect(await client.fetchQuery(options)).toEqual({ kind: "found", value: event });
  });

  it.each([
    { kind: "api", status: 404, title: "Unknown", detail: "Unknown" },
    { kind: "api", status: 503, code: "NOT_FOUND", title: "Unavailable", detail: "Unavailable" },
    new TypeError("Network unavailable"),
  ])("does not turn an unconfirmed failure into cached absence (%j)", async (error) => {
    await expect(
      loadResourceReadResult(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
