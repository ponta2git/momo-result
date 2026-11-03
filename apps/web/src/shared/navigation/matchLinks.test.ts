// @vitest-environment node
import { describe, expect, it } from "vitest";

import { matchRecordHref } from "@/shared/navigation/matchLinks";

describe("match record links", () => {
  it("encodes the held event the same way for both ways of recording", () => {
    expect(matchRecordHref("held/a", "ocr")).toBe("/ocr/new?heldEventId=held%2Fa");
    expect(matchRecordHref("held/a", "manual")).toBe("/matches/new?heldEventId=held%2Fa");
  });
});
