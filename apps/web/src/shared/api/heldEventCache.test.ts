// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  mergeHeldEventItems,
  syncHeldEventCreatedCache,
  syncHeldEventDeletedCache,
} from "@/shared/api/heldEventCache";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { heldEventKeys } from "@/shared/api/queryKeys";
import { createTestQueryClient } from "@/test/queryClient";

const olderEvent: HeldEventResponse = {
  draftCount: 0,
  id: "held-old",
  heldAt: "2026-01-01T00:00:00.000Z",
  matchCount: 1,
  nextMatchNo: 2,
};

const newerEvent: HeldEventResponse = {
  draftCount: 0,
  id: "held-new",
  heldAt: "2026-01-02T00:00:00.000Z",
  matchCount: 0,
  nextMatchNo: 1,
};

describe("held event cache contract", () => {
  it("prepends an individually loaded event only when the list does not contain it", () => {
    expect(mergeHeldEventItems([newerEvent], olderEvent)).toEqual([olderEvent, newerEvent]);
    expect(mergeHeldEventItems([newerEvent], { ...newerEvent, matchCount: 9 })).toEqual([
      newerEvent,
    ]);
  });

  it("seeds the created event summary while leaving page membership to the server", async () => {
    const queryClient = createTestQueryClient();
    const pageListKey = heldEventKeys.list({ page: 1, pageSize: 25 });
    const pageList = { items: [olderEvent] };
    queryClient.setQueryData(heldEventKeys.summary(olderEvent.id), olderEvent);
    queryClient.setQueryData(pageListKey, pageList);

    await syncHeldEventCreatedCache(queryClient, newerEvent);

    expect(queryClient.getQueryData(heldEventKeys.summary(newerEvent.id))).toEqual(newerEvent);
    expect(queryClient.getQueryData(heldEventKeys.detail(newerEvent.id))).toBeUndefined();
    expect(queryClient.getQueryData(pageListKey)).toBe(pageList);
    expect(queryClient.getQueryState(heldEventKeys.summary(newerEvent.id))?.isInvalidated).toBe(
      false,
    );
    expect(queryClient.getQueryState(heldEventKeys.summary(olderEvent.id))?.isInvalidated).toBe(
      false,
    );
    expect(queryClient.getQueryState(pageListKey)?.isInvalidated).toBe(true);
  });

  it("evicts the deleted event's detail and summary and invalidates list pages", async () => {
    const queryClient = createTestQueryClient();
    const pageListKey = heldEventKeys.list({ page: 2, pageSize: 25 });
    const pageList = { items: [newerEvent] };
    queryClient.setQueryData(heldEventKeys.detail(newerEvent.id), newerEvent);
    queryClient.setQueryData(heldEventKeys.summary(newerEvent.id), newerEvent);
    queryClient.setQueryData(heldEventKeys.summaryRead(newerEvent.id), {
      kind: "found",
      value: newerEvent,
    });
    queryClient.setQueryData(heldEventKeys.summary(olderEvent.id), olderEvent);
    queryClient.setQueryData(pageListKey, pageList);

    await syncHeldEventDeletedCache(queryClient, newerEvent.id);

    expect(queryClient.getQueryData(heldEventKeys.detail(newerEvent.id))).toBeUndefined();
    expect(queryClient.getQueryData(heldEventKeys.summary(newerEvent.id))).toBeUndefined();
    expect(queryClient.getQueryData(heldEventKeys.summaryRead(newerEvent.id))).toBeUndefined();
    expect(queryClient.getQueryData(heldEventKeys.summary(olderEvent.id))).toEqual(olderEvent);
    expect(queryClient.getQueryData(pageListKey)).toBe(pageList);
    expect(queryClient.getQueryState(heldEventKeys.summary(olderEvent.id))?.isInvalidated).toBe(
      false,
    );
    expect(queryClient.getQueryState(pageListKey)?.isInvalidated).toBe(true);
  });
});
