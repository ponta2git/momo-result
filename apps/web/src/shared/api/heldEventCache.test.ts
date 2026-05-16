// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  syncHeldEventCreatedCache,
  syncHeldEventDeletedCache,
  upsertHeldEventList,
} from "@/shared/api/heldEventCache";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { heldEventKeys } from "@/shared/api/queryKeys";

const olderEvent: HeldEventResponse = {
  id: "held-old",
  heldAt: "2026-01-01T00:00:00.000Z",
  matchCount: 1,
};

const newerEvent: HeldEventResponse = {
  id: "held-new",
  heldAt: "2026-01-02T00:00:00.000Z",
  matchCount: 0,
};

describe("held event cache contract", () => {
  it("upserts held events in newest-first order without duplicates", () => {
    const result = upsertHeldEventList(
      { items: [olderEvent, { ...newerEvent, matchCount: 2 }] },
      newerEvent,
    );

    expect(result.items).toEqual([newerEvent, olderEvent]);
  });

  it("updates the scoped list and invalidates all held event caches after create", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(heldEventKeys.scope("workspace"), { items: [olderEvent] });
    queryClient.setQueryData(heldEventKeys.scope("held-events-page"), { items: [olderEvent] });

    await syncHeldEventCreatedCache(queryClient, "workspace", newerEvent);

    expect(queryClient.getQueryData(heldEventKeys.scope("workspace"))).toEqual({
      items: [newerEvent, olderEvent],
    });
    expect(queryClient.getQueryState(heldEventKeys.scope("workspace"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(heldEventKeys.scope("held-events-page"))?.isInvalidated).toBe(
      true,
    );
  });

  it("updates the scoped list and invalidates all held event caches after delete", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(heldEventKeys.scope("held-events-page"), {
      items: [newerEvent, olderEvent],
    });
    queryClient.setQueryData(heldEventKeys.scope("workspace"), { items: [newerEvent, olderEvent] });

    await syncHeldEventDeletedCache(queryClient, "held-events-page", newerEvent.id);

    expect(queryClient.getQueryData(heldEventKeys.scope("held-events-page"))).toEqual({
      items: [olderEvent],
    });
    expect(queryClient.getQueryState(heldEventKeys.scope("held-events-page"))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(heldEventKeys.scope("workspace"))?.isInvalidated).toBe(true);
  });
});
