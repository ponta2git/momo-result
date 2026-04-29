import { describe, expect, it, vi } from "vitest";
import {
  createInitialSlot,
  releaseSlotResources,
  requestedImageTypeForSlot,
  validateImageFile,
} from "@/features/ocrCapture/captureState";

describe("captureState", () => {
  it("uses auto for uploads and slot kind for camera captures", () => {
    expect(
      requestedImageTypeForSlot({ kind: "total_assets", source: "upload", forcedKind: false }),
    ).toBe("auto");
    expect(
      requestedImageTypeForSlot({ kind: "revenue", source: "camera", forcedKind: false }),
    ).toBe("revenue");
    expect(
      requestedImageTypeForSlot({ kind: "incident_log", source: "upload", forcedKind: true }),
    ).toBe("incident_log");
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
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;

    releaseSlotResources({
      ...createInitialSlot("total_assets"),
      previewUrl: "blob:test",
      cameraStream: stream,
    });

    expect(revoke).toHaveBeenCalledWith("blob:test");
    expect(stop).toHaveBeenCalledOnce();
  });
});
