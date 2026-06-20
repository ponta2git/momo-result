// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { getOcrDraft, getOcrDraftsBulk } from "@/shared/api/ocrDrafts";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";

setupMsw();

describe("ocr drafts api", () => {
  it("loads a single OCR draft", async () => {
    setDevUser();

    await expect(getOcrDraft("draft-1")).resolves.toMatchObject({
      draftId: "draft-1",
    });
  });

  it("loads OCR drafts in bulk", async () => {
    setDevUser();

    await expect(getOcrDraftsBulk(["draft-1", "draft-2"])).resolves.toMatchObject({
      items: [{ draftId: "draft-1" }, { draftId: "draft-2" }],
    });
  });
});
