// @vitest-environment node
import { describe, expect, it } from "vitest";

import { heldEventOcrCaptureHref } from "@/features/heldEvents/heldEventNavigation";

describe("held event navigation", () => {
  it("encodes the selected held event in the OCR destination", () => {
    expect(heldEventOcrCaptureHref("held/a")).toBe("/ocr/new?heldEventId=held%2Fa");
  });
});
