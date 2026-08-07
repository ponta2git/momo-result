// @vitest-environment node
import { describe, expect, it } from "vitest";

import { heldEventOcrCaptureHref } from "@/features/heldEvents/heldEventNavigation";

describe("held event navigation", () => {
  it("preserves the held-event destination and current list location", () => {
    expect(heldEventOcrCaptureHref("held/a", "/held-events?pageSize=25")).toBe(
      "/ocr/new?heldEventId=held%2Fa&returnTo=%2Fheld-events%3FpageSize%3D25",
    );
  });

  it("does not attach an unsafe return destination", () => {
    expect(heldEventOcrCaptureHref("held-1", "https://example.com/held-events")).toBe(
      "/ocr/new?heldEventId=held-1",
    );
  });
});
