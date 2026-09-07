// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  createInitialSlot,
  releaseSlotResources,
  requestedScreenTypeForSlot,
  validateImageFile,
} from "@/features/ocrCapture/captureState";
import { installObjectUrlMock } from "@/test/doubles/dom";

describe("captureState", () => {
  it("uses the final classification tray as the OCR screen type hint", () => {
    expect(requestedScreenTypeForSlot({ kind: "total_assets" })).toBe("total_assets");
    expect(requestedScreenTypeForSlot({ kind: "revenue" })).toBe("revenue");
    expect(requestedScreenTypeForSlot({ kind: "incident_log" })).toBe("incident_log");
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

  it("releases preview object URLs", () => {
    const objectUrls = installObjectUrlMock();

    releaseSlotResources({
      ...createInitialSlot("total_assets"),
      previewUrl: "blob:test",
    });

    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
