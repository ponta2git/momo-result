import { describe, expect, it, vi } from "vitest";

import {
  createInitialSlot,
  releaseSlotResources,
  requestedImageTypeForSlot,
  validateImageFile,
} from "@/features/ocrCapture/captureState";
import { createMockMediaStream } from "@/test/doubles/dom";

describe("captureState", () => {
  it("uses the final classification tray as the OCR image type hint", () => {
    expect(requestedImageTypeForSlot({ kind: "total_assets" })).toBe("total_assets");
    expect(requestedImageTypeForSlot({ kind: "revenue" })).toBe("revenue");
    expect(requestedImageTypeForSlot({ kind: "incident_log" })).toBe("incident_log");
  });

  it("validates image type and size before upload", () => {
    expect(validateImageFile(new File(["x"], "ok.png", { type: "image/png" }))).toBeUndefined();
    expect(validateImageFile(new File(["x"], "bad.gif", { type: "image/gif" }))).toContain("PNG");
    expect(
      validateImageFile(
        new File([new Uint8Array(3 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
      ),
    ).toContain("3MB");
  });

  it("releases object URLs and camera tracks", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { stream, track } = createMockMediaStream();

    releaseSlotResources({
      ...createInitialSlot("total_assets"),
      previewUrl: "blob:test",
      cameraStream: stream,
    });

    expect(revoke).toHaveBeenCalledWith("blob:test");
    expect(track.stop).toHaveBeenCalledOnce();
  });
});
