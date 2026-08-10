// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  invalidateAfterDraftCancelled,
  invalidateAfterMatchConfirmed,
  invalidateAfterMatchUpdated,
  invalidateAfterOcrSubmissionStarted,
} from "@/shared/api/cacheInvalidation";
import { heldEventKeys, matchKeys, ocrDraftKeys, seriesAnalysisKeys } from "@/shared/api/queryKeys";
import { createTestQueryClient } from "@/test/queryClient";

describe("shared query keys", () => {
  it("invalidates mutable analysis state but preserves pinned artifacts after confirmation", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(matchKeys.list({ status: "confirmed" }), { items: [] });
    queryClient.setQueryData(matchKeys.draft.detail("draft-1"), { matchDraftId: "draft-1" });
    queryClient.setQueryData(matchKeys.draft.sourceImages("draft-1"), { items: [] });
    queryClient.setQueryData(ocrDraftKeys.bulk(["ocr-draft-1"]), { items: [] });
    queryClient.setQueryData(heldEventKeys.scope("workspace"), { items: [] });
    queryClient.setQueryData(seriesAnalysisKeys.options(), { titles: [] });
    queryClient.setQueryData(seriesAnalysisKeys.status("gt-1"), { gameTitleId: "gt-1" });
    queryClient.setQueryData(seriesAnalysisKeys.adminOverview("gt-1"), { recentJobs: [] });
    queryClient.setQueryData(seriesAnalysisKeys.aggregate({ artifactId: "artifact-1" }), {
      artifact: { artifactId: "artifact-1" },
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
    expect(queryClient.getQueryState(seriesAnalysisKeys.options())?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(seriesAnalysisKeys.status("gt-1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(seriesAnalysisKeys.adminOverview("gt-1"))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(seriesAnalysisKeys.aggregate({ artifactId: "artifact-1" }))
        ?.isInvalidated,
    ).toBe(false);
  });

  it("invalidates match detail and mutable analysis state after match update", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(matchKeys.detail("match-1"), { matchId: "match-1" });
    queryClient.setQueryData(seriesAnalysisKeys.status("gt-1"), { gameTitleId: "gt-1" });
    queryClient.setQueryData(seriesAnalysisKeys.aggregate({ artifactId: "artifact-1" }), {
      artifact: { artifactId: "artifact-1" },
    });

    await invalidateAfterMatchUpdated(queryClient, "match-1");

    expect(queryClient.getQueryState(matchKeys.detail("match-1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(seriesAnalysisKeys.status("gt-1"))?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(seriesAnalysisKeys.aggregate({ artifactId: "artifact-1" }))
        ?.isInvalidated,
    ).toBe(false);
  });

  it("does not invalidate analysis when OCR drafts start or are cancelled", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(heldEventKeys.detail("held-1"), { id: "held-1" });
    queryClient.setQueryData(seriesAnalysisKeys.status("gt-1"), { gameTitleId: "gt-1" });
    queryClient.setQueryData(seriesAnalysisKeys.aggregate({ artifactId: "artifact-1" }), {
      artifact: { artifactId: "artifact-1" },
    });

    await invalidateAfterOcrSubmissionStarted(queryClient);
    expect(queryClient.getQueryState(heldEventKeys.detail("held-1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(seriesAnalysisKeys.status("gt-1"))?.isInvalidated).toBe(false);
    expect(
      queryClient.getQueryState(seriesAnalysisKeys.aggregate({ artifactId: "artifact-1" }))
        ?.isInvalidated,
    ).toBe(false);

    queryClient.setQueryData(heldEventKeys.detail("held-1"), { id: "held-1" });
    await invalidateAfterDraftCancelled(queryClient);
    expect(queryClient.getQueryState(heldEventKeys.detail("held-1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(seriesAnalysisKeys.status("gt-1"))?.isInvalidated).toBe(false);
  });

  it("preserves OCR draft id boundaries in bulk keys", () => {
    expect(ocrDraftKeys.bulk(["draft-a,b", "draft-c"])).not.toEqual(
      ocrDraftKeys.bulk(["draft-a", "b,draft-c"]),
    );
  });
});
