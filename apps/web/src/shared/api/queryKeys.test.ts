// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  invalidateAfterMatchConfirmed,
  invalidateAfterMatchUpdated,
} from "@/shared/api/cacheInvalidation";
import {
  heldEventKeys,
  matchKeys,
  ocrDraftKeys,
  seriesComparisonKeys,
} from "@/shared/api/queryKeys";
import { createTestQueryClient } from "@/test/queryClient";

describe("shared query keys", () => {
  it("invalidates match, draft, OCR, and held event caches after match confirmation", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(matchKeys.list({ status: "confirmed" }), { items: [] });
    queryClient.setQueryData(matchKeys.draft.detail("draft-1"), { matchDraftId: "draft-1" });
    queryClient.setQueryData(matchKeys.draft.sourceImages("draft-1"), { items: [] });
    queryClient.setQueryData(ocrDraftKeys.bulk(["ocr-draft-1"]), { items: [] });
    queryClient.setQueryData(heldEventKeys.scope("workspace"), { items: [] });
    queryClient.setQueryData(seriesComparisonKeys.aggregate({ gameTitleId: "gt-1" }), {
      matchTimeline: [],
    });

    await invalidateAfterMatchConfirmed(queryClient);

    expect(queryClient.getQueryState(matchKeys.list({ status: "confirmed" }))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(matchKeys.draft.detail("draft-1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(matchKeys.draft.sourceImages("draft-1"))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(ocrDraftKeys.bulk(["ocr-draft-1"]))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(heldEventKeys.scope("workspace"))?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(seriesComparisonKeys.aggregate({ gameTitleId: "gt-1" }))
        ?.isInvalidated,
    ).toBe(true);
  });

  it("invalidates match detail and series comparison caches after match update", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(matchKeys.detail("match-1"), { matchId: "match-1" });
    queryClient.setQueryData(seriesComparisonKeys.aggregate({ gameTitleId: "gt-1" }), {
      matchTimeline: [],
    });

    await invalidateAfterMatchUpdated(queryClient, "match-1");

    expect(queryClient.getQueryState(matchKeys.detail("match-1"))?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(seriesComparisonKeys.aggregate({ gameTitleId: "gt-1" }))
        ?.isInvalidated,
    ).toBe(true);
  });

  it("preserves OCR draft id boundaries in bulk keys", () => {
    expect(ocrDraftKeys.bulk(["draft-a,b", "draft-c"])).not.toEqual(
      ocrDraftKeys.bulk(["draft-a", "b,draft-c"]),
    );
  });
});
