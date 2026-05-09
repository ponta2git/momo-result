import { describe, expect, it } from "vitest";

import { getOcrDraftsBulk } from "@/shared/api/ocrDrafts";

describe("ocr drafts api", () => {
  it("loads OCR drafts in bulk", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

    await expect(getOcrDraftsBulk(["draft-1", "draft-2"])).resolves.toMatchObject({
      items: [{ draftId: "draft-1" }, { draftId: "draft-2" }],
    });
  });
});
