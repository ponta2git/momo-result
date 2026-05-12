// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { invalidateAfterMatchConfirmed } from "@/shared/api/cacheInvalidation";
import { heldEventKeys, matchKeys, ocrDraftKeys } from "@/shared/api/queryKeys";

describe("shared query keys", () => {
  it("invalidates match, draft, OCR, and held event caches after match confirmation", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(matchKeys.list({ status: "confirmed" }), { items: [] });
    queryClient.setQueryData(matchKeys.draft.detail("draft-1"), { matchDraftId: "draft-1" });
    queryClient.setQueryData(matchKeys.draft.sourceImages("draft-1"), { items: [] });
    queryClient.setQueryData(ocrDraftKeys.bulk("ocr-draft-1"), { items: [] });
    queryClient.setQueryData(heldEventKeys.scope("workspace"), { items: [] });

    await invalidateAfterMatchConfirmed(queryClient);

    expect(queryClient.getQueryState(matchKeys.list({ status: "confirmed" }))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(matchKeys.draft.detail("draft-1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(matchKeys.draft.sourceImages("draft-1"))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(ocrDraftKeys.bulk("ocr-draft-1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(heldEventKeys.scope("workspace"))?.isInvalidated).toBe(true);
  });
});
